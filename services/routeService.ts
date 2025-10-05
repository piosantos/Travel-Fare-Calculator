import { Coordinates, Waypoint, RouteData, Routes } from '../types';

// Geocode location using Nominatim
export const geocodeLocation = async (name: string): Promise<Coordinates> => {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name + ', Indonesia')}&format=json&limit=1`
  );
  if (!response.ok) {
    throw new Error(`Geocoding failed for ${name}.`);
  }
  const data = await response.json();
  if (data.length === 0) throw new Error(`Location not found: ${name}`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
};

// Internal function to get a single route from Google Maps
const getGoogleRoute = async (coords: Coordinates[], avoidTolls: boolean): Promise<RouteData> => {
  if (!process.env.API_KEY) {
    throw new Error('Google Maps API key is not configured.');
  }
  
  const origin = {
    location: { latLng: { latitude: coords[0].lat, longitude: coords[0].lon } }
  };
  const destination = {
    location: { latLng: { latitude: coords[coords.length - 1].lat, longitude: coords[coords.length - 1].lon } }
  };

  const requestBody: any = {
    origin,
    destination,
    travelMode: 'DRIVE',
    routeModifiers: {
      vehicleInfo: { emissionType: 'GASOLINE' },
      avoidTolls: avoidTolls
    },
    languageCode: 'id',
    units: 'METRIC'
  };

  if (!avoidTolls) {
    requestBody.extraComputations = ['TOLLS'];
  }

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.API_KEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorBody = await response.json();
    console.error("Google Routes API Error:", errorBody);
    throw new Error('Google Routes API failed. Check your API key and billing settings.');
  }

  const data = await response.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error('No route found for the given waypoints.');
  }

  const route = data.routes[0];
  let tollCost = 0;

  if (route.travelAdvisory?.tollInfo?.estimatedPrice) {
    const prices = route.travelAdvisory.tollInfo.estimatedPrice;
    for (const price of prices) {
      if (price.currencyCode === 'IDR') {
        tollCost += (price.units || 0) + (price.nanos || 0) / 1e9;
      }
    }
  }

  return {
    distance: route.distanceMeters / 1000,
    duration: parseInt((route.duration || '0s').replace('s', '')),
    tollCost: Math.round(tollCost)
  };
};

// Main function to fetch both toll and toll-free routes
export const fetchAllRoutes = async (waypoints: Waypoint[]): Promise<Routes> => {
  if (waypoints.some(wp => !wp.name.trim())) {
      throw new Error('All waypoint locations must be filled in.');
  }

  const geocodedCoords = await Promise.all(
    waypoints.map(wp => geocodeLocation(wp.name))
  );

  const [tollRouteResult, tollFreeRouteResult] = await Promise.allSettled([
    getGoogleRoute(geocodedCoords, false),
    getGoogleRoute(geocodedCoords, true)
  ]);

  const toll = tollRouteResult.status === 'fulfilled' ? tollRouteResult.value : null;
  const tollFree = tollFreeRouteResult.status === 'fulfilled' ? tollFreeRouteResult.value : null;
  
  if (tollRouteResult.status === 'rejected') {
    console.error("Toll route error:", tollRouteResult.reason);
  }
  if (tollFreeRouteResult.status === 'rejected') {
     console.error("Toll-free route error:", tollFreeRouteResult.reason);
  }

  if (!toll && !tollFree) {
    const reason = tollRouteResult.status === 'rejected' ? tollRouteResult.reason.message : 'No routes returned from API.';
    throw new Error(`Could not fetch any routes. ${reason}`);
  }

  return { toll, tollFree };
};
