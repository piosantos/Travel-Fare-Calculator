export interface Coordinates {
  lat: number;
  lon: number;
}

export interface Waypoint {
  id: string;
  name: string;
}

export interface RouteData {
  distance: number; // in km
  duration: number; // in seconds
  tollCost: number; // in IDR
}

export interface Routes {
  toll: RouteData | null;
  tollFree: RouteData | null;
}

export type RouteType = 'toll' | 'tollFree';

export interface FareSettings {
  roundTrip: boolean;
  fuelConsumption: number;
  fuelPrice: number;
  fixedCosts: number;
  margin: number;
  passengers: number;
}

export interface FareDetails {
  totalKm: number;
  totalDuration: number;
  liters: number;
  fuelCost: number;
  tollCost: number;
  subtotal: number;
  marginAmount: number;
  total: number;
  perKm: number;
  perPax: number;
}
