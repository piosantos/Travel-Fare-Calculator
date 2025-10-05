import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, DollarSign, Fuel, Calculator, Plus, X, Sparkles, GripVertical, TrendingUp, Copy, Car, Users, Save, Trash2, Pencil, XCircle, Route, Eye, EyeOff, Shuffle } from 'lucide-react';

// @google/genai-codex-fix: Add type definition for Leaflet on the window object
// Fix: Add type definition for Leaflet which is loaded via a script tag.
declare global {
  interface Window {
    L: any;
  }
}

// --- HELPER: Polyline Decoder ---
// Decodes polyline strings from OSRM to an array of [lat, lng] coordinates
function decodePolyline(str, precision) {
  let index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change,
    factor = Math.pow(10, precision || 5);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change; lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
};

const App = () => {
  // --- STATE MANAGEMENT ---
  const [waypoints, setWaypoints] = useState([{ id: 'start', name: 'Surakarta', coords: null }, { id: 'end', name: 'Semarang', coords: null }]);
  const [routeType, setRouteType] = useState('toll');
  const [routes, setRoutes] = useState({ toll: null, tollFree: null });
  const [roundTrip, setRoundTrip] = useState(true);
  const [fuelConsumption, setFuelConsumption] = useState(10);
  const [fuelPrice, setFuelPrice] =useState(16500);
  const [fixedCosts, setFixedCosts] = useState(250000);
  const [manualTollCost, setManualTollCost] = useState(0);
  const [margin, setMargin] = useState(20);
  const [passengers, setPassengers] = useState(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copySuccess, setCopySuccess] = useState('');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [vehiclePresets, setVehiclePresets] = useState(() => { try { const s = localStorage.getItem('vehiclePresets'); return s ? JSON.parse(s) : []; } catch (e) { return []; } });
  const [selectedPresetId, setSelectedPresetId] = useState('custom');
  const [showDirections, setShowDirections] = useState(false);
  const [optimizeFor, setOptimizeFor] = useState('order'); // 'order', 'duration', 'distance'

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  const geocodingCache = useRef({});

  // --- EFFECTS ---
  useEffect(() => { localStorage.setItem('vehiclePresets', JSON.stringify(vehiclePresets)); }, [vehiclePresets]);
  useEffect(() => { if (selectedPresetId === 'custom') return; const p = vehiclePresets.find(p => p.id === selectedPresetId); if (p) { setFuelConsumption(p.fuelConsumption); setPassengers(p.passengers); } }, [selectedPresetId, vehiclePresets]);
  useEffect(() => { const p = vehiclePresets.find(p => p.id === selectedPresetId); if (p && (fuelConsumption !== p.fuelConsumption || passengers !== p.passengers)) { setSelectedPresetId('custom'); } }, [fuelConsumption, passengers, selectedPresetId, vehiclePresets]);
  useEffect(() => { // Load Leaflet CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css';
    link.integrity = 'sha512-xodZBNTC5n17Xt2atTPuE1HxjVMSvLVW9ocqUKLsCC5CXdbqCmblAshOMAS6/keqq/sMZMZ19scR4PsZChSR7A==';
    link.crossOrigin = '';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  // --- FORMATTERS & HELPERS ---
  const fmtIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
  const fmtDuration = (s) => { if (!s) return '0m'; const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const copyToClipboard = (text) => {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta);
    ta.focus(); ta.select(); try { document.execCommand('copy'); setCopySuccess('Copied!'); } catch (err) { setCopySuccess('Failed!'); }
    document.body.removeChild(ta); setTimeout(() => setCopySuccess(''), 2000);
  };

  // --- API & DATA FETCHING ---
  const geocodeLocation = async (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Waypoint name cannot be empty.');
    if (geocodingCache.current[trimmedName]) return geocodingCache.current[trimmedName]; // Use cache

    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmedName + ', Indonesia')}&format=json&limit=1`);
    const d = await r.json();
    if (d.length === 0) throw new Error(`Location not found: ${trimmedName}`);
    
    const result = { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
    geocodingCache.current[trimmedName] = result; // Save to cache
    return result;
  };
    const getOsrmMatrix = async (coords, metric = 'duration') => {
        if (coords.length < 2) return [];
        const coordStr = coords.map(c => `${c.lon},${c.lat}`).join(';');
        const url = `https://router.project-osrm.org/table/v1/driving/${coordStr}?annotations=${metric}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Failed to fetch route matrix from OSRM. Status: ${r.status}`);
        const d = await r.json();
        if (d.code !== 'Ok') throw new Error(`Could not get route matrix: ${d.message || 'Unknown error'}`);
        return d[metric === 'duration' ? 'durations' : 'distances'];
    };
  const getOpenStreetMapRoute = async (coords, avoidTolls = false) => {
    if (coords.length < 2) throw new Error('At least two waypoints are required.');
    const coordStr = coords.map(c => `${c.lon},${c.lat}`).join(';');
    let url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=polyline&steps=true`;
    if (avoidTolls) url += '&exclude=toll';

    const r = await fetch(url);
    if (!r.ok) throw new Error('Failed to fetch route from OpenStreetMap API.');
    const d = await r.json();
    if (d.code !== 'Ok' || !d.routes || d.routes.length === 0) throw new Error(`No route found.`);
    const route = d.routes[0];
    
    return {
      distance: route.distance / 1000,
      duration: route.duration,
      geometry: route.geometry, // Encoded polyline for the map
      steps: route.legs.flatMap(leg => leg.steps), // Combine steps from all legs
      waypoints: d.waypoints, // OSRM waypoints with snapped coordinates
    };
  };
  const handleCalculateRoutes = async () => {
    setLoading(true); setError(null); setRoutes({ toll: null, tollFree: null });
    try {
      const geocodedCoords = await Promise.all(waypoints.map(wp => geocodeLocation(wp.name)));
      let orderedWaypoints = [...waypoints];
      let orderedCoords = [...geocodedCoords];

      if (optimizeFor !== 'order' && waypoints.length > 2) {
          const matrix = await getOsrmMatrix(geocodedCoords, optimizeFor);
          const optimalIndices = findOptimalOrder(matrix);
          
          orderedWaypoints = optimalIndices.map(i => waypoints[i]);
          orderedCoords = optimalIndices.map(i => geocodedCoords[i]);
          
          setWaypoints(orderedWaypoints); // Update UI to reflect new order
      }
      
      const [tollRoute, tollFreeRoute] = await Promise.all([
        getOpenStreetMapRoute(orderedCoords, false),
        getOpenStreetMapRoute(orderedCoords, true).catch(e => { console.warn(e.message); return null; })
      ]);
      setRoutes({ toll: tollRoute, tollFree: tollFreeRoute });
      setShowDirections(false); // Reset directions view on new calculation
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  // --- CORE CALCULATION LOGIC ---
  const calculateFare = (route) => {
    if (!route) return null;
    const m = roundTrip ? 2 : 1;
    const totalKm = route.distance * m, totalDuration = route.duration * m;
    const liters = fuelConsumption > 0 ? totalKm / fuelConsumption : 0;
    const fuelCost = liters * fuelPrice, tollCost = manualTollCost * m;
    const subtotal = fuelCost + fixedCosts + tollCost;
    const marginAmount = (margin / 100) * subtotal;
    const total = subtotal + marginAmount;
    const perKm = totalKm > 0 ? total / totalKm : 0;
    const perPax = passengers > 0 ? total / passengers : 0;
    return { totalKm, totalDuration, liters, fuelCost, tollCost, subtotal, marginAmount, total, perKm, perPax };
  };

  const selectedRoute = routes[routeType];
  const selectedFare = calculateFare(selectedRoute);
  const tollFare = calculateFare(routes.toll);
  const tollFreeFare = calculateFare(routes.tollFree);

  // --- EVENT HANDLERS ---
  const addWaypoint = () => { setWaypoints([...waypoints.slice(0,-1), {id:Date.now().toString(),name:'',coords:null}, waypoints[waypoints.length-1]]); };
  const removeWaypoint = (id) => { if (waypoints.length > 2) setWaypoints(waypoints.filter(wp => wp.id !== id)); };
  const updateWaypoint = (id, value) => { setWaypoints(waypoints.map(wp => wp.id === id ? { ...wp, name: value } : wp)); };
  const handleDragStart = (e, i) => { dragItem.current = i; document.body.classList.add('dragging'); };
  const handleDragEnter = (e, i) => { dragOverItem.current = i; };
  const handleDragEnd = () => { if (dragItem.current !== null && dragOverItem.current !== null) { const newWaypoints = [...waypoints]; if (dragOverItem.current > 0 && dragOverItem.current < newWaypoints.length - 1) { const dragged = newWaypoints.splice(dragItem.current, 1)[0]; newWaypoints.splice(dragOverItem.current, 0, dragged); setWaypoints(newWaypoints); } } dragItem.current = null; dragOverItem.current = null; document.body.classList.remove('dragging'); };
  const savePreset = (preset) => { const existing = vehiclePresets.find(p => p.id === preset.id); if (existing) { setVehiclePresets(vehiclePresets.map(p => p.id === preset.id ? preset : p)); } else { setVehiclePresets([...vehiclePresets, { ...preset, id: Date.now().toString() }]); } };
  const deletePreset = (id) => { setVehiclePresets(vehiclePresets.filter(p => p.id !== id)); };

  // --- RENDER LOGIC ---
  return (
    <>
      <style>{`.dragging,.dragging *{cursor:grabbing !important} .leaflet-container { height: 400px; width: 100%; border-radius: 0.75rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);}`}</style>
      <div className="min-h-screen bg-gray-50 font-sans p-4 sm:p-6 md:p-8">
        <div className="max-w-7xl mx-auto">
          <header className="text-center mb-8"><h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-2">🚗 Travel Fare Calculator</h1><p className="text-gray-600">Powered by OpenStreetMap. ETA does not include live traffic.</p></header>
          <main className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <section className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2 mb-4"><Navigation size={24} className="text-blue-600" />Route Planner</h2>
                <div className="space-y-3">{waypoints.map((wp, idx) => (<div key={wp.id} className={`flex items-center gap-2 group ${idx > 0 && idx < waypoints.length - 1 ? 'draggable' : ''}`} draggable={idx > 0 && idx < waypoints.length - 1} onDragStart={(e) => handleDragStart(e, idx)} onDragEnter={(e) => handleDragEnter(e, idx)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()}><GripVertical size={20} className={`text-gray-400 ${idx > 0 && idx < waypoints.length - 1 ? 'cursor-grab' : 'opacity-0'}`} /><div className="flex-1 relative"><MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} /><input type="text" value={wp.name} onChange={(e) => updateWaypoint(wp.id, e.target.value)} placeholder={idx === 0 ? "Start Location" : idx === waypoints.length - 1 ? "End Location" : "Intermediate Stop"} className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" /></div>{waypoints.length > 2 && idx > 0 && idx < waypoints.length - 1 && (<button onClick={() => removeWaypoint(wp.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg"><X size={20} /></button>)}</div>))}</div>
                <div className="mt-4 grid sm:grid-cols-3 gap-3">
                    <button onClick={addWaypoint} className="sm:col-span-1 flex items-center justify-center gap-2 px-4 py-2 text-blue-600 border-2 border-blue-100 hover:bg-blue-50 rounded-lg font-medium"><Plus size={20} />Add Stop</button>
                    <div className="relative sm:col-span-1">
                        <Shuffle size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        <select id="optimize" value={optimizeFor} onChange={(e) => setOptimizeFor(e.target.value)} disabled={waypoints.length <= 2} className="w-full h-full text-center sm:text-left pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed font-medium text-gray-700" aria-label="Route optimization">
                            <option value="order">Current Order</option>
                            <option value="duration">Fastest Time</option>
                            <option value="distance">Shortest Distance</option>
                        </select>
                    </div>
                    <button onClick={handleCalculateRoutes} disabled={loading} className="sm:col-span-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2">{loading ? (<><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Calculating...</>) : 'Calculate'}</button>
                </div>
                {error && <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 font-medium">{error}</div>}
              </section>

              {selectedRoute && <MapDisplay route={selectedRoute} waypoints={waypoints} />}
              
              {(routes.toll || routes.tollFree) && (
                <section className="bg-white rounded-xl shadow-md p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">Route Options</h2>
                  <div className="grid md:grid-cols-2 gap-4">{routes.toll && (<button onClick={() => setRouteType('toll')} className={`p-4 rounded-lg border-2 text-left transition-all ${routeType === 'toll' ? 'border-blue-500 bg-blue-50 shadow-lg scale-105':'border-gray-200 hover:border-gray-300'}`}><div className="flex justify-between items-start mb-2"><div><h3 className="font-semibold text-gray-800 flex items-center gap-1.5"><Sparkles size={16} className="text-yellow-500"/> Standard Route</h3><p className="text-sm text-gray-500">May include tolls</p></div>{tollFare && <span className="text-lg font-bold text-blue-600">{fmtIDR(tollFare.total)}</span>}</div><p className="text-sm text-gray-600 mt-2 font-medium">{routes.toll.distance.toFixed(0)} km • {fmtDuration(routes.toll.duration)}</p></button>)}{routes.tollFree && (<button onClick={() => setRouteType('tollFree')} className={`p-4 rounded-lg border-2 text-left transition-all ${routeType === 'tollFree' ? 'border-blue-500 bg-blue-50 shadow-lg scale-105':'border-gray-200 hover:border-gray-300'}`}><div className="flex justify-between items-start mb-2"><div><h3 className="font-semibold text-gray-800">🛣️ Alternate Route</h3><p className="text-sm text-gray-500">Tries to avoid tolls</p></div>{tollFreeFare && <span className="text-lg font-bold text-blue-600">{fmtIDR(tollFreeFare.total)}</span>}</div><p className="text-sm text-gray-600 mt-2 font-medium">{routes.tollFree.distance.toFixed(0)} km • {fmtDuration(routes.tollFree.duration)}</p></button>)}</div>
                </section>
              )}

              {selectedRoute && <DirectionsDisplay steps={selectedRoute.steps} show={showDirections} onToggle={() => setShowDirections(!showDirections)} />}
              
              {selectedFare && (<section className="bg-white rounded-xl shadow-md p-6"><h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Calculator size={24} className="text-blue-600"/>Cost Breakdown</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center md:text-left"><InfoCard label="Total Distance" value={`${selectedFare.totalKm.toFixed(0)} km`} /><InfoCard label="Travel Time (no traffic)" value={fmtDuration(selectedFare.totalDuration)} /><InfoCard label="Fuel Needed" value={`${selectedFare.liters.toFixed(1)}L`} /><InfoCard label="Fuel Cost" value={fmtIDR(selectedFare.fuelCost)} /><InfoCard label="Toll Fees (Manual)" value={fmtIDR(selectedFare.tollCost)} highlight="emerald" /><InfoCard label="Fixed Costs" value={fmtIDR(fixedCosts)} /><InfoCard label="Subtotal" value={fmtIDR(selectedFare.subtotal)} /><InfoCard label={`Margin (${margin}%)`} value={fmtIDR(selectedFare.marginAmount)} /></div></section>)}
            </div>
            <aside className="space-y-6">
              <section className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><DollarSign size={24} className="text-blue-600"/>Fare Settings</h2>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-100"><input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-2 focus:ring-blue-500" /><span className="font-medium text-gray-700">Round Trip</span></label><hr/>
                  <InputGroup label="Manual Toll Cost (One-Way)" value={manualTollCost} onChange={setManualTollCost} />
                  <div><div className="flex justify-between items-center mb-1"><label className="block text-sm font-medium text-gray-700">Vehicle Preset</label><button onClick={() => setIsPresetModalOpen(true)} className="text-sm text-blue-600 hover:underline font-medium">Manage Presets</button></div><select value={selectedPresetId} onChange={(e) => setSelectedPresetId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"><option value="custom">Custom Vehicle</option>{vehiclePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                  <InputGroup label="Fuel Consumption (km/L)" value={fuelConsumption} onChange={setFuelConsumption} icon={Fuel}/><InputGroup label="Number of Passengers" value={passengers} onChange={setPassengers} icon={Users}/><InputGroup label="Fuel Price (Rp/L)" value={fuelPrice} onChange={setFuelPrice} /><InputGroup label="Fixed Costs (Driver, etc.)" value={fixedCosts} onChange={setFixedCosts} /><InputGroup label="Profit Margin (%)" value={margin} onChange={setMargin} />
                </div>
              </section>
              {selectedFare && (<section className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg p-6 text-white text-center sticky top-6"><h2 className="text-lg font-semibold mb-2 flex items-center justify-center gap-2"><TrendingUp size={20}/>Suggested Total Fare</h2><p className="text-sm opacity-90 mb-4">{routeType==='toll' ? '✨ Standard Route':'🛣️ Alternate Route'}</p><div className="text-5xl font-bold mb-4">{fmtIDR(selectedFare.total)}</div><div className="space-y-1 text-sm opacity-90 bg-black bg-opacity-10 p-2 rounded-lg"><p>≈ {fmtIDR(selectedFare.perKm)} per km</p><p>≈ {fmtIDR(selectedFare.perPax)} per passenger ({passengers} people)</p></div><button onClick={() => copyToClipboard(Math.round(selectedFare.total))} className="mt-4 w-full bg-white text-blue-600 py-3 rounded-lg font-semibold hover:bg-gray-100 flex items-center justify-center gap-2"><Copy size={18} /> {copySuccess || 'Copy Total Fare'}</button></section>)}
            </aside>
          </main>
          <footer className="mt-8 text-center text-sm text-gray-500"><p>Route data powered by OpenStreetMap. All estimates are for planning purposes only.</p></footer>
        </div>
      </div>
      {isPresetModalOpen && <PresetManagerModal presets={vehiclePresets} onSave={savePreset} onDelete={deletePreset} onClose={() => setIsPresetModalOpen(false)} />}
    </>
  );
};
// --- SUB-COMPONENTS ---
// @google/genai-codex-fix: Add explicit prop types and make 'icon' optional.
// Fix: Add explicit types for props and make the 'icon' prop optional to fix missing property errors.
const InputGroup = ({ label, value, onChange, icon: Icon, type = 'number' }: {
    label: string;
    value: string | number;
    onChange: (value: any) => void;
    icon?: React.ElementType;
    type?: string;
}) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
            {Icon && <Icon size={16} className="inline text-gray-500"/>} {label}
        </label>
        <input 
            type={type} 
            value={value} 
            onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} 
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
    </div>
);
const InfoCard = ({ label, value, highlight = 'gray' }) => { const c = { gray: 'text-gray-800', emerald: 'text-emerald-600' }; return (<div className="p-3 bg-gray-50 rounded-lg"><p className="text-sm text-gray-600">{label}</p><p className={`text-lg font-bold ${c[highlight]}`}>{value}</p></div>);};
const PresetManagerModal = ({ presets, onSave, onDelete, onClose }) => { const [editingPreset, setEditingPreset] = useState(null); const handleSave = (e) => { e.preventDefault(); onSave(editingPreset); setEditingPreset(null); }; const startEditing = (p) => setEditingPreset({...p}); const startNew = () => setEditingPreset({ id: null, name: '', fuelConsumption: 10, passengers: 12 }); return (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50"><div className="bg-white rounded-xl shadow-2xl w-full max-w-md"><div className="flex justify-between items-center p-4 border-b"><h2 className="text-xl font-bold text-gray-800">Manage Vehicle Presets</h2><button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800"><XCircle size={24}/></button></div><div className="p-6 max-h-[60vh] overflow-y-auto">{editingPreset ? (<form onSubmit={handleSave} className="space-y-4 bg-gray-50 p-4 rounded-lg"><h3 className="font-semibold">{editingPreset.id ? 'Edit Preset' : 'Add New Preset'}</h3><InputGroup label="Preset Name" value={editingPreset.name} onChange={val => setEditingPreset({...editingPreset, name: val})} type="text" /><InputGroup label="Fuel Consumption (km/L)" value={editingPreset.fuelConsumption} onChange={val => setEditingPreset({...editingPreset, fuelConsumption: val})} icon={Fuel}/><InputGroup label="Passengers" value={editingPreset.passengers} onChange={val => setEditingPreset({...editingPreset, passengers: val})} icon={Users}/><div className="flex gap-2"><button type="button" onClick={() => setEditingPreset(null)} className="flex-1 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 font-medium">Cancel</button><button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Save</button></div></form>) : (<div className="space-y-3">{presets.map(preset => (<div key={preset.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"><div><p className="font-semibold">{preset.name}</p><p className="text-sm text-gray-600">{preset.fuelConsumption} km/L, {preset.passengers} passengers</p></div><div className="flex gap-2"><button onClick={() => startEditing(preset)} className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"><Pencil size={18}/></button><button onClick={() => onDelete(preset.id)} className="p-2 text-red-500 hover:bg-red-100 rounded-lg"><Trash2 size={18}/></button></div></div>))}<button onClick={startNew} className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 text-blue-600 border-2 border-blue-100 hover:bg-blue-50 rounded-lg font-medium"><Plus size={20} /> Add New Preset</button></div>)}</div></div></div>);};

// --- NEW SUB-COMPONENTS for Map and Directions ---

const MapDisplay = ({ route, waypoints }) => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const { geometry, waypoints: routeWaypoints } = route;

  useEffect(() => {
    let isMounted = true;
    const loadLeaflet = () => {
      if (window.L) {
        if (isMounted) initializeMap();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js';
      script.integrity = 'sha512-XQoYMqMTK8LvdxXYG3nZ448hOEQiglfqkJs1NOQV44cWnUrBc8PkAOcXy20w0vlaXaVUearIOBhiXZ5V3ynxwA==';
      script.crossOrigin = '';
      document.body.appendChild(script);
      script.onload = () => {
        if (isMounted) initializeMap();
      };
    };
    
    loadLeaflet();

    return () => {
      isMounted = false;
    }
  }, []);
  
  const initializeMap = () => {
    if (mapRef.current || !mapContainerRef.current || !window.L || !window.L.map) return;

    mapRef.current = window.L.map(mapContainerRef.current).setView([-2.5489, 118.0149], 5);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapRef.current);
  };

  useEffect(() => {
    if (!mapRef.current || !window.L || !geometry) return;
    const map = mapRef.current;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }
    
    // @google/genai-codex-fix: Add missing precision argument to decodePolyline.
    // Fix: Provide the precision argument (5 for OSRM) to the decodePolyline function.
    const coordinates = decodePolyline(geometry, 5);
    const polyline = window.L.polyline(coordinates, { color: 'blue', weight: 5 });

    const markers = routeWaypoints.map((wp, index) => {
      const location = wp.location.reverse(); // OSRM is [lon, lat], Leaflet is [lat, lon]
      const label = waypoints[index]?.name || 'Waypoint';
      const title = index === 0 ? 'Start' : index === waypoints.length - 1 ? 'End' : 'Stop';
      return window.L.marker(location).bindPopup(`<b>${title}</b><br>${label}`);
    });

    layerRef.current = window.L.featureGroup([polyline, ...markers]).addTo(map);
    map.fitBounds(layerRef.current.getBounds().pad(0.1));

  }, [geometry, routeWaypoints, waypoints]);

  return <section ref={mapContainerRef} className="bg-white rounded-xl shadow-md" />;
};

const DirectionsDisplay = ({ steps, show, onToggle }) => {
  if (!steps || steps.length === 0) return null;

  const getIconForManeuver = (type) => {
    if (type.includes('left')) return '↰';
    if (type.includes('right')) return '↱';
    if (type.includes('straight') || type.includes('continue')) return '↑';
    if (type.includes('roundabout')) return '⟳';
    if (type.includes('arrive')) return '🏁';
    return '•';
  };

  return (
    <section className="bg-white rounded-xl shadow-md p-6">
      <button onClick={onToggle} className="w-full flex justify-between items-center text-lg font-bold text-gray-800">
        <div className="flex items-center gap-2">
            <Route size={24} className="text-blue-600"/>
            Turn-by-Turn Directions
        </div>
        {show ? <EyeOff/> : <Eye/>}
      </button>
      {show && (
        <div className="mt-4 border-t pt-4 max-h-96 overflow-y-auto space-y-2 pr-2">
          <ol className="list-none space-y-3">
            {steps.map((step, index) => (
              <li key={index} className="flex items-start gap-3 text-sm">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-blue-100 text-blue-700 font-bold text-lg">{getIconForManeuver(step.maneuver.type)}</span>
                <div className="flex-1">
                    <p className="font-medium text-gray-800">{step.maneuver.instruction}</p>
                    <p className="text-gray-500">{(step.distance / 1000).toFixed(1)} km</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// --- TSP Solver Helpers ---
// Heap's algorithm for generating permutations
const permute = function* (permutation) {
    const length = permutation.length;
    const c = Array(length).fill(0);
    let i = 1, k, p;

    yield permutation.slice();
    while (i < length) {
        if (c[i] < i) {
            k = i % 2 ? c[i] : 0;
            p = permutation[i];
            permutation[i] = permutation[k];
            permutation[k] = p;
            c[i]++;
            i = 1;
            yield permutation.slice();
        } else {
            c[i] = 0;
            i++;
        }
    }
};

const findOptimalOrder = (matrix) => {
    const numPoints = matrix.length;
    if (numPoints <= 2) return Array.from({ length: numPoints }, (_, i) => i);
    
    const intermediateIndices = Array.from({ length: numPoints - 2 }, (_, i) => i + 1);
    let bestPermutation = [...intermediateIndices];
    let minCost = Infinity;

    // Calculate cost for the initial, un-permuted order as a baseline
    const initialPath = [0, ...intermediateIndices, numPoints - 1];
    let initialCost = 0;
    for (let i = 0; i < initialPath.length - 1; i++) {
        initialCost += matrix[initialPath[i]][initialPath[i+1]];
    }
    minCost = initialCost;

    for (const p of permute(intermediateIndices)) {
        let currentCost = 0;
        // Cost from start to first intermediate
        currentCost += matrix[0][p[0]];
        // Cost between intermediate points
        for (let i = 0; i < p.length - 1; i++) {
            currentCost += matrix[p[i]][p[i+1]];
        }
        // Cost from last intermediate to end
        currentCost += matrix[p[p.length - 1]][numPoints - 1];
        
        if (currentCost < minCost) {
            minCost = currentCost;
            bestPermutation = [...p];
        }
    }
    return [0, ...bestPermutation, numPoints - 1];
};


export default App;
