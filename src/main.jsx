import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './styles.css';

const MAP_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
// Used only as a neutral map view when the browser has not supplied GPS coordinates.
const DEMO_LOCATION = { name: 'GPS location unavailable', coords: [78.9629, 20.5937], isFallback: true };
const roads = [
  { name: 'Low-lying arterial 01', level: 'Severe', depth: 38, rainfall: 62, prediction: 'Peak in 28 min', coords: [[77.590,12.969],[77.597,12.973]] },
  { name: 'East collector road', level: 'High', depth: 24, rainfall: 48, prediction: 'Peak in 42 min', coords: [[77.596,12.965],[77.603,12.970]] },
  { name: 'Central connector', level: 'Moderate', depth: 13, rainfall: 36, prediction: 'Peak in 55 min', coords: [[77.584,12.969],[77.592,12.975]] },
  { name: 'North access road', level: 'Low', depth: 5, rainfall: 24, prediction: 'Stable for 90 min', coords: [[77.582,12.974],[77.591,12.977]] },
];
const intersections = [
  { name:'Low-lying intersection', level:'Severe', depth:41, rainfall:64, prediction:'Peak in 24 min', coords:[77.5946,12.9721] },
  { name:'East junction', level:'High', depth:27, rainfall:51, prediction:'Peak in 37 min', coords:[77.5968,12.9684] },
  { name:'Central intersection', level:'Moderate', depth:14, rainfall:35, prediction:'Peak in 58 min', coords:[77.5888,12.9726] },
];
const zones = [
  [[77.588,12.966],[77.599,12.966],[77.599,12.974],[77.588,12.974],[77.588,12.966]],
  [[77.598,12.962],[77.607,12.962],[77.607,12.971],[77.598,12.971],[77.598,12.962]],
];
const riskColor = { Severe: '#f05268', High: '#ff9f43', Moderate: '#ffd166', Low: '#3dd9b3', Safe: '#46d99b' };
const routePalette = ['#5da8ff', '#ff9f43', '#3dd9b3'];
const isValidLngLat = value => Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const hasValidRouteGeometry = route => Array.isArray(route?.coordinates) && route.coordinates.length >= 2 && route.coordinates.every(isValidLngLat);
const validRoutesOnly = routes => Array.isArray(routes) ? routes.filter(hasValidRouteGeometry) : [];
const safeLocationCoordinates = location => isValidLngLat(location?.coords) ? location.coords : DEMO_LOCATION.coords;
const formatDistance = meters => `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
const formatDuration = seconds => `${Math.max(1, Math.round(seconds / 60))} min`;
const demoFloodAssessment = (index, route) => {
  // Demo-only values until the flood model/back-end supplies corridor exposure.
  const profiles = [
    { level:'High', depth:32, penalty:18, description:'Shorter path with higher mock flood exposure' },
    { level:'Moderate', depth:13, penalty:8, description:'Balanced mock flood exposure' },
    { level:'Low', depth:4, penalty:2, description:'Lowest mock flood exposure' },
  ];
  const profile = profiles[index % profiles.length];
  return { ...route, ...profile, riskScore: profile.penalty + route.duration / 60 };
};
const routeFeatureCollection = routes => ({
  type:'FeatureCollection',
  features:validRoutesOnly(routes).map(route => ({ type:'Feature', properties:{ id:route.id, color:route.color }, geometry:{type:'LineString',coordinates:route.coordinates.map(([longitude,latitude])=>[longitude,latitude])} })),
});
const simulationResult = (intensity, duration) => {
  const stormScore = intensity * (duration / 30);
  const severity = stormScore >= 300 ? 'Severe' : stormScore >= 160 ? 'High' : stormScore >= 80 ? 'Moderate' : 'Low';
  const depth = Math.min(68, Math.round(4 + intensity * 0.33 + duration * 0.17));
  const affected = Math.min(19, Math.max(3, Math.round(2 + stormScore / 24)));
  const highRisk = Math.min(11, Math.max(1, Math.round(stormScore / 52)));
  const drainage = stormScore >= 300 ? 'Critical overload' : stormScore >= 160 ? 'Overloaded' : stormScore >= 80 ? 'Near capacity' : 'Operating normally';
  const mapRoads = roads.map((road, index) => {
    const level = index === 0 ? severity : index === 1 && severity !== 'Low' ? (severity === 'Severe' ? 'High' : severity) : index === 2 && stormScore >= 160 ? 'Moderate' : 'Low';
    return { ...road, level, depth: Math.max(3, depth - index * 9), rainfall: intensity, prediction: `Peak in ${Math.max(18, 80 - Math.round(stormScore / 8))} min` };
  });
  return { intensity, duration, severity, depth, affected, highRisk, drainage, mapRoads };
};
const shiftPoint = (point, location) => { const locationCoords=safeLocationCoordinates(location); return [point[0] + locationCoords[0] - DEMO_LOCATION.coords[0], point[1] + locationCoords[1] - DEMO_LOCATION.coords[1]]; };
const localizedRoads = (items, location) => items.map(road => ({...road, coords:road.coords.map(point=>shiftPoint(point,location))}));
const roadCollection = (items, location) => ({type:'FeatureCollection',features:localizedRoads(items,location).map((r,i)=>({type:'Feature',properties:{...r,i},geometry:{type:'LineString',coordinates:r.coords}}))});
const Icon = ({ children }) => <span className="icon">{children}</span>;

function MapView({ selected, simulation = null, route = false, routes = [], destination = null, selectedRoute, preview = false, location = DEMO_LOCATION, onSelect, onRouteDataError }) {
  const mapNode = useRef(null); const map = useRef(null); const locationMarker = useRef(null); const destinationMarker = useRef(null); const currentLocation = useRef(location); const currentRoutes = useRef(routes);
  useEffect(()=>{currentLocation.current=location;},[location]);
  useEffect(()=>{currentRoutes.current=routes;},[routes]);
  useEffect(() => {
    mapboxgl.accessToken = MAP_TOKEN;
    const mapStyle = MAP_TOKEN ? 'mapbox://styles/mapbox/dark-v11' : 'https://demotiles.maplibre.org/style.json';
    map.current = new mapboxgl.Map({ container: mapNode.current, style: mapStyle, center: safeLocationCoordinates(location), zoom: preview ? 12.8 : 13.7, attributionControl: false, interactive: !preview });
    map.current.on('load', () => {
      const m = map.current; const activeLocation = currentLocation.current;
      m.addSource('zones', { type:'geojson', data:{type:'FeatureCollection',features:zones.map((coordinates,i)=>({type:'Feature',properties:{i},geometry:{type:'Polygon',coordinates:[coordinates.map(point=>shiftPoint(point,activeLocation))]}}))} });
      m.addLayer({ id:'zone-fill', type:'fill', source:'zones', paint:{'fill-color':['case',['==',['get','i'],0],'#ff4f73','#ff9c42'],'fill-opacity':.16} });
      m.addLayer({ id:'zone-line', type:'line', source:'zones', paint:{'line-color':'#ff7a8e','line-width':1,'line-opacity':.65} });
      m.addSource('roads', { type:'geojson', data:roadCollection(simulation?.mapRoads || roads, activeLocation) });
      const colorExpression=['match',['get','level'],'Severe','#f05268','High','#ff9f43','Moderate','#ffd166','#3dd9b3'];
      m.addLayer({ id:'roads-glow', type:'line', source:'roads', paint:{'line-color':colorExpression,'line-width':11,'line-opacity':.2,'line-blur':6} });
      m.addLayer({ id:'roads-line', type:'line', source:'roads', paint:{'line-color':colorExpression,'line-width':4,'line-opacity':.98} });
      m.addSource('intersections', {type:'geojson',data:{type:'FeatureCollection',features:intersections.map((p,i)=>({type:'Feature',properties:{...p,i},geometry:{type:'Point',coordinates:shiftPoint(p.coords,activeLocation)}}))}});
      m.addLayer({id:'intersection-halo',type:'circle',source:'intersections',paint:{'circle-radius':14,'circle-color':colorExpression,'circle-opacity':.18,'circle-blur':.4}});
      m.addLayer({id:'intersection-point',type:'circle',source:'intersections',paint:{'circle-radius':6,'circle-color':colorExpression,'circle-stroke-width':2,'circle-stroke-color':'#eff8ff'}});
      if(route) { m.addSource('routes', {type:'geojson',data:routeFeatureCollection(currentRoutes.current)}); m.addLayer({id:'route-casing',type:'line',source:'routes',paint:{'line-color':'#07131f','line-width':['case',['==',['get','id'],selectedRoute],9,6],'line-opacity':.9}}); m.addLayer({id:'route-lines',type:'line',source:'routes',paint:{'line-color':['coalesce',['get','color'],'#5da8ff'],'line-width':['case',['==',['get','id'],selectedRoute],6,3],'line-opacity':['case',['==',['get','id'],selectedRoute],1,.45]}}); }
      if(!preview){ locationMarker.current=new mapboxgl.Marker({color:'#60a5fa'}).setLngLat(safeLocationCoordinates(activeLocation)).setPopup(new mapboxgl.Popup({offset:18}).setText(activeLocation.name)).addTo(m); }
      m.addControl(new mapboxgl.NavigationControl({showCompass:false}),'top-right');
      m.addControl(new mapboxgl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true,showUserHeading:true}),'top-right');
      const selectFeature = (e) => onSelect?.(e.features[0].properties);
      m.on('click','roads-line',selectFeature); m.on('click','intersection-point',selectFeature);
      ['roads-line','intersection-point'].forEach(id=>{m.on('mouseenter',id,()=>m.getCanvas().style.cursor='pointer'); m.on('mouseleave',id,()=>m.getCanvas().style.cursor='');});
    });
    return () => map.current?.remove();
  }, []);
  useEffect(()=>{ if(map.current?.getLayer('roads-line')) map.current.setPaintProperty('roads-line','line-width',['case',['==',['get','name'],selected?.name||''],6,4]); },[selected]);
  useEffect(()=>{ const source=map.current?.getSource('roads'); if(source) source.setData(roadCollection(simulation?.mapRoads || roads,location)); },[simulation,location]);
  useEffect(()=>{ const m=map.current; if(!m) return; const locationCoords=safeLocationCoordinates(location); m.flyTo({center:locationCoords,essential:true,duration:650}); locationMarker.current?.setLngLat(locationCoords).setPopup(new mapboxgl.Popup({offset:18}).setText(location.name)); const zoneSource=m.getSource('zones'); const intersectionSource=m.getSource('intersections'); if(zoneSource) zoneSource.setData({type:'FeatureCollection',features:zones.map((coordinates,i)=>({type:'Feature',properties:{i},geometry:{type:'Polygon',coordinates:[coordinates.map(point=>shiftPoint(point,location))]}}))}); if(intersectionSource) intersectionSource.setData({type:'FeatureCollection',features:intersections.map((p,i)=>({type:'Feature',properties:{...p,i},geometry:{type:'Point',coordinates:shiftPoint(p.coords,location)}}))}); },[location]);
  useEffect(()=>{ const m=map.current; const source=m?.getSource('routes'); if(!m || !source) return; const validRoutes=validRoutesOnly(routes); source.setData(routeFeatureCollection(validRoutes)); if(routes.length && !validRoutes.length) onRouteDataError?.('Route data was invalid. Please try the destination again.'); const destinationCoords=isValidLngLat(destination?.coords) ? destination.coords : null; if(destinationCoords){ if(!destinationMarker.current) destinationMarker.current=new mapboxgl.Marker({color:'#ff667d'}).setPopup(new mapboxgl.Popup({offset:18}).setText(destination.name || 'Destination')).setLngLat(destinationCoords).addTo(m); else destinationMarker.current.setLngLat(destinationCoords); } else { destinationMarker.current?.remove(); destinationMarker.current=null; }
    const routeCoordinates=validRoutes.flatMap(item=>item.coordinates); if(!routeCoordinates.length) return; const boundsPoints=[...routeCoordinates,safeLocationCoordinates(location),...(destinationCoords?[destinationCoords]:[])]; const bounds=new mapboxgl.LngLatBounds(boundsPoints[0],boundsPoints[0]); boundsPoints.slice(1).forEach(point=>bounds.extend(point)); m.fitBounds(bounds,{padding:65,maxZoom:14.5,duration:700}); },[routes,destination,location,onRouteDataError]);
  useEffect(()=>{ if(map.current?.getLayer('route-lines')) { map.current.setPaintProperty('route-lines','line-width',['case',['==',['get','id'],selectedRoute],6,3]); map.current.setPaintProperty('route-lines','line-opacity',['case',['==',['get','id'],selectedRoute],1,.5]); map.current.setPaintProperty('route-casing','line-width',['case',['==',['get','id'],selectedRoute],9,6]); } },[selectedRoute]);
  return <div className={`map ${preview?'map-preview':''}`} ref={mapNode}><div className="map-fallback">{!MAP_TOKEN && <span>Map preview · Add VITE_MAPBOX_TOKEN for Mapbox basemap</span>}</div></div>;
}

const Nav = ({ page, setPage }) => <nav><button className="brand" onClick={()=>setPage('home')}><span>◈</span> Urban Now-casting</button><div className="nav-links">{[['home','Home'],['dashboard','Dashboard'],['simulation','What-If Simulation'],['navigation','Navigation']].map(([id,label])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}>{label}</button>)}</div><div className="status"><i/> Live nowcasting</div></nav>;
const Badge = ({level}) => <span className={`badge ${level.toLowerCase()}`}>{level}</span>;
const Legend = () => <div className="legend"><b>Flood risk</b>{['Low','Moderate','High','Severe'].map(x=><span key={x}><i style={{background:riskColor[x]}}/>{x} risk</span>)}</div>;

function Home({setPage}) { return <><section className="hero"><div className="hero-copy"><div className="eyebrow">● CITY-READY FLOOD INTELLIGENCE</div><h1>Predict floods<br/><em>before they happen.</em></h1><p>Street-level urban flood nowcasting for the next 0–3 hours. Turn complex weather and infrastructure signals into faster, safer decisions.</p><div className="actions"><button className="primary" onClick={()=>setPage('dashboard')}>Open live dashboard <b>→</b></button><button className="secondary" onClick={()=>setPage('simulation')}>Try what-if simulation</button></div><div className="hero-trust"><span>◉ Updated every 5 min</span><span>⌖ Street-level resolution</span></div></div><div className="hero-map"><MapView preview/><div className="map-card"><span className="pulse"/> LIVE FLOOD RISK<br/><strong>12</strong> roads need attention <small>Next 90 min</small></div><Legend/></div></section><section className="intro"><p className="eyebrow">BUILT FOR URBAN RESPONSE TEAMS</p><h2>Rainfall alone doesn’t tell you<br/>which street will flood.</h2><p>FloodGuard combines live precipitation, terrain, drainage capacity and street networks to make urban flood risk clear, local and actionable.</p></section><section className="how"><p className="eyebrow">HOW IT WORKS</p><div className="pipeline">{['Weather / Rainfall','Terrain / DEM','Drainage','ML & Simulation','GIS','Action'].map((x,i)=><React.Fragment key={x}><div><span>0{i+1}</span>{x}</div>{i<5&&<b>→</b>}</React.Fragment>)}</div></section><section className="features">{[['⌖','Street-level prediction','Know which roads and intersections may flood, not just the neighborhood.'],['◌','Dynamic risk mapping','Visualize severity, water depth and overload signals as conditions change.'],['↗','Flood-aware navigation','Route residents and responders around unsafe corridors.'],['◈','What-if weather simulation','Test a changing storm before it becomes an emergency.']].map(([i,t,p])=><article key={t}><Icon>{i}</Icon><h3>{t}</h3><p>{p}</p></article>)}</section><section className="stats">{[['0–3 hr','Prediction window'],['Street-level','Risk resolution'],['Water depth','Severity estimates'],['5 min','Live refresh cadence']].map(([a,b])=><div key={b}><strong>{a}</strong><span>{b}</span></div>)}</section><footer>© 2026 FloodGuard <span>Urban flood intelligence, made actionable.</span></footer></> }

function Dashboard({location}){ const [selected,setSelected]=useState(roads[0]); const [tick,setTick]=useState(0); useEffect(()=>{const id=setInterval(()=>setTick(t=>t+1),7000);return()=>clearInterval(id)},[]); useEffect(()=>setSelected(roads[0]),[location]); return <main className="app-page dashboard"><PageHead eyebrow="LIVE OPERATIONS" title="Flood nowcasting dashboard" right={<div className="updated"><i/> Last updated just now</div>}/><section className="metrics">{[['42','mm/hr','Rainfall intensity','High'],['12','roads','At-risk corridors','Severe'],['3','zones','High-risk zones','High'],['41','cm','Max predicted depth','Severe']].map(([n,u,l,r])=><div className="metric" key={l}><span>{l}</span><strong>{n}<small>{u}</small></strong><Badge level={r}/></div>)}</section><section className="dashboard-grid"><div className="map-panel"><MapView location={location} selected={selected} onSelect={setSelected}/><Legend/><div className="forecast"><span>FORECAST TIMELINE</span><b>Now</b><i/><b>+1h</b><i/><b>+2h</b><i/><b>+3h</b></div></div><aside className="side-panel"><div className="panel-title"><div><span>CURRENT LOCATION</span><h3>{location.name}</h3><small>{selected.name}</small></div><Badge level={selected.level}/></div><div className="depth"><span>Predicted water depth</span><strong>{selected.depth}<small>cm</small></strong><div><i style={{width:`${Math.min(selected.depth*2,100)}%`}}/></div></div><div className="info-row"><span>Rainfall intensity</span><b>{selected.rainfall} mm/hr</b></div><div className="info-row"><span>Prediction time</span><b>{selected.prediction}</b></div><div className="info-row"><span>Drainage status</span><b className={selected.level==='Low'?'':'danger'}>{selected.level==='Low'?'Normal':'Overloaded'}</b></div><button className="full-button">Click any road or intersection to inspect</button></aside></section><section className="bottom-grid"><div className="alerts"><div className="section-title"><h3>Recent alerts</h3><button>View all</button></div>{[['Severe','Low-lying underpass','Flood depth may exceed 35 cm','2 min ago'],['High','East collector corridor','Drainage capacity exceeded','8 min ago'],['Moderate','Central connector','Standing water developing','14 min ago']].map(([l,t,d,time])=><div className="alert" key={t}><Badge level={l}/><div><b>{t}</b><span>{d}</span></div><time>{time}</time></div>)}</div><div className="risk-summary"><h3>Risk summary</h3><p>Next 90 minutes</p><div className="risk-bar"><i/><i/><i/><i/></div><div className="summary-labels"><span>Low<br/><b>24</b></span><span>Moderate<br/><b>8</b></span><span>High<br/><b>5</b></span><span>Severe<br/><b>2</b></span></div></div></section></main> }
function PageHead({eyebrow,title,right}){return <header className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{right}</header>}

function Simulation({location}){ const [intensity,setIntensity]=useState(40); const [duration,setDuration]=useState(30); const [result,setResult]=useState(null); const [selected,setSelected]=useState(roads[0]); const preview=simulationResult(intensity,duration); const active=result || { ...simulationResult(20,15), mapRoads: roads }; const run=()=>{ const next=simulationResult(intensity,duration); setResult(next); setSelected(next.mapRoads[0]); }; const reset=()=>{setIntensity(40);setDuration(30);setResult(null);setSelected(roads[0]);}; useEffect(()=>setSelected(roads[0]),[location]); return <main className="app-page"><PageHead eyebrow="SCENARIO PLANNING" title="What-if flood simulation" right={<div className="scenario">Scenario <b>#{result?'02':'01'}</b></div>}/><div className="sim-grid"><aside className="controls"><h3>Storm conditions</h3><p>Change the storm profile, then run a localized flood-risk scenario.</p><label>Rainfall intensity <b>{intensity} mm/hr</b><div className="choice-grid">{[20,40,60,80,100,120].map(value=><button className={intensity===value?'chosen':''} onClick={()=>setIntensity(value)} key={value}>{value}</button>)}</div></label><label>Rainfall duration <b>{duration===60?'1 hour':duration===120?'2 hours':`${duration} min`}</b><div className="duration-grid">{[[15,'15 min'],[30,'30 min'],[60,'1 hour'],[120,'2 hours']].map(([value,label])=><button className={duration===value?'chosen':''} onClick={()=>setDuration(value)} key={value}>{label}</button>)}</div></label><hr/><div className="control-stat"><span>Scenario severity</span><Badge level={preview.severity}/></div><button className="primary run" onClick={run}>Run simulation <b>→</b></button>{result&&<button className="reset-button" onClick={reset}>Reset simulation</button>}</aside><section className="sim-map"><MapView location={location} simulation={active} selected={selected} onSelect={setSelected}/><Legend/><div className="sim-stamp">{result?'SIMULATED':'BASELINE'}<br/><b>{result?`${result.intensity} mm/hr`:'20 mm/hr'}</b> rainfall</div>{result&&<div className="simulation-message">● Simulation predicts {result.severity.toLowerCase()} flood risk around low-lying roads.</div>}<div className="map-selection simulation-selection"><span>SELECTED LOCATION</span><b>{location.name}</b><small><Badge level={selected.level}/> {selected.depth} cm water depth · {selected.rainfall} mm/hr</small></div></section></div><section className="scenario-summary"><div><p className="eyebrow">IMPACT COMPARISON</p><h2>Before vs. simulated scenario</h2></div>{[['Affected roads','3 roads',`${active.affected} roads`],['High-risk roads','1 road',`${active.highRisk} roads`],['Max water depth','11 cm',`${active.depth} cm`],['Drainage status','Normal',active.drainage]].map(([a,b,c])=><div className="compare" key={a}><span>{a}</span><b>{b}</b><i>→</i><strong>{c}</strong></div>)}</section></main> }

function Navigation({location,locationError}){
  const [route,setRoute]=useState(null); const [selected,setSelected]=useState(roads[0]); const [destination,setDestination]=useState(''); const [destinationPlace,setDestinationPlace]=useState(null); const [routes,setRoutes]=useState([]); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const activeRoute=routes.find(item=>item.id===route);
  const handleRouteDataError=React.useCallback(message=>{setRoutes([]);setRoute(null);setDestinationPlace(null);setError(message);},[]);
  const findRoutes=async()=>{
    const query=destination.trim(); setError(''); setRoutes([]); setRoute(null); setDestinationPlace(null);
    if(!query){ setError('Enter a destination to find safer routes.'); return; }
    if(location.isFallback){ setError(locationError || 'Current GPS location is required before routing. Allow location access and try again.'); return; }
    if(!isValidLngLat(location.coords)){ setError('Current GPS location is invalid. Please allow location access and try again.'); return; }
    if(!MAP_TOKEN){ setError('Routing is not configured. Add VITE_MAPBOX_TOKEN to enable destination search and directions.'); return; }
    setLoading(true);
    try {
      const geocodeResponse=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&access_token=${encodeURIComponent(MAP_TOKEN)}`);
      if(!geocodeResponse.ok) throw new Error('Destination search failed.');
      const geocode=await geocodeResponse.json(); const match=geocode.features?.[0];
      if(!isValidLngLat(match?.center)){ setError('Destination not found. Try a more specific place or address.'); return; }
      const destinationData={name:match.place_name || query,coords:match.center};
      const coordinates=`${location.coords.join(',')};${match.center.join(',')}`;
      const directionsResponse=await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?alternatives=true&geometries=geojson&overview=full&steps=false&access_token=${encodeURIComponent(MAP_TOKEN)}`);
      if(!directionsResponse.ok) throw new Error('Routing service failed.');
      const directions=await directionsResponse.json();
      if(!directions.routes?.length) throw new Error('No drivable route was found for this destination.');
      const evaluated=directions.routes.map((item,index)=>{
        const routeCoordinates=item?.geometry?.coordinates;
        if(!Array.isArray(routeCoordinates) || routeCoordinates.length < 2 || !routeCoordinates.every(isValidLngLat)) return null;
        return demoFloodAssessment(index,{id:`route-${index}`,name:index===0?'Fastest route':`Safestroute ${index}`,distance:Number.isFinite(item.distance)?item.distance:0,duration:Number.isFinite(item.duration)?item.duration:0,coordinates:routeCoordinates,color:routePalette[index % routePalette.length]});
      }).filter(Boolean);
      if(!evaluated.length) throw new Error('The routing service returned invalid route geometry. Please try again.');
      const recommended=[...evaluated].sort((a,b)=>a.riskScore-b.riskScore)[0];
      setDestinationPlace(destinationData); setRoutes(evaluated); setRoute(recommended.id);
    } catch (requestError) { setError(requestError.message || 'Unable to calculate routes. Please try again.'); }
    finally { setLoading(false); }
  };
  useEffect(()=>setSelected(roads[0]),[location]);
  return <main className="app-page"><PageHead eyebrow="ROUTE INTELLIGENCE" title="Flood-aware navigation" right={<div className="updated"><i/> Demo flood-risk scoring</div>}/><div className="nav-grid"><aside className="route-panel"><label>START LOCATION<div className="location-input"><i className="start-dot"/><input aria-label="Current GPS location" value={location.name} readOnly/></div></label><div className="route-line"/><label>DESTINATION<div className="location-input"><i className="end-dot"/><input aria-label="Destination" value={destination} onChange={event=>setDestination(event.target.value)} placeholder="Enter any place or address" onKeyDown={event=>event.key==='Enter'&&findRoutes()}/></div></label><button className="primary full" onClick={findRoutes} disabled={loading}>{loading?'Finding routes…':'Find safer routes'} <b>→</b></button>{error&&<p className="route-error" role="alert">{error}</p>}<div className="route-heading"><h3>Route options</h3><span>{routes.length ? `${routes.length} found` : 'Awaiting destination'}</span></div>{routes.map(item=><button onClick={()=>setRoute(item.id)} className={`route-option ${route===item.id?'selected':''}`} key={item.id}><div><b>{item.id===activeRoute?.id?'Recommended · ':''}{item.name}</b><span>{item.description} · DEMO flood data</span></div><strong>{formatDuration(item.duration)}<small>{formatDistance(item.distance)} · <Badge level={item.level}/> {item.depth} cm</small></strong></button>)}</aside><section className="route-map"><MapView location={location} route routes={routes} destination={destinationPlace} selectedRoute={route} selected={selected} onSelect={setSelected} onRouteDataError={handleRouteDataError}/><Legend/>{activeRoute&&<div className="route-overlay"><span>{activeRoute.id===route&&activeRoute.riskScore===Math.min(...routes.map(item=>item.riskScore))?'RECOMMENDED SAFER ROUTE':'SELECTED ROUTE'}</span><h3>{activeRoute.name}</h3><p>{formatDuration(activeRoute.duration)} · {formatDistance(activeRoute.distance)}</p><div><b>{activeRoute.level} risk</b> &nbsp; <b>{activeRoute.depth} cm</b> demo max water depth</div></div>}<div className="map-selection"><span>CURRENT LOCATION</span><b>{location.name}</b><small><Badge level={selected.level}/> {selected.depth} cm · {selected.rainfall} mm/hr · {selected.prediction}</small></div></section></div>{activeRoute&&<section className="route-details"><div><span>ROUTE SAFETY · DEMO FLOOD DATA</span><h3>{activeRoute.id===route&&activeRoute.riskScore===Math.min(...routes.map(item=>item.riskScore))?'Recommended because it has the lowest modeled flood penalty.':activeRoute.description}</h3></div><div className="route-step"><b>1</b><p>Depart from current GPS location<br/><small>Start point</small></p></div><div className="route-step"><b>2</b><p>Follow the selected route<br/><small>{activeRoute.level} risk · {activeRoute.depth} cm demo exposure</small></p></div><div className="route-step"><b>3</b><p>Arrive at destination<br/><small>{destinationPlace?.name || 'Destination'}</small></p></div></section>}</main>
}

function App(){const [page,setPage]=useState('home'); const [location,setLocation]=useState(DEMO_LOCATION); const [locationError,setLocationError]=useState(''); useEffect(()=>{if(!navigator.geolocation){setLocationError('This browser does not support location services.');return;} navigator.geolocation.getCurrentPosition(position=>{setLocation({name:'Current GPS location',coords:[position.coords.longitude,position.coords.latitude],isFallback:false});setLocationError('');},error=>{setLocation(DEMO_LOCATION);setLocationError(error.code===error.PERMISSION_DENIED?'Location permission was denied. Allow it to route from your current GPS location.':'Current GPS location could not be determined. Please try again.');},{enableHighAccuracy:true,timeout:8000,maximumAge:300000});},[]); return <><Nav page={page} setPage={setPage}/>{page==='home'?<Home setPage={setPage}/>:page==='dashboard'?<Dashboard location={location}/>:page==='simulation'?<Simulation location={location}/>:<Navigation location={location} locationError={locationError}/>}</>};
createRoot(document.getElementById('root')).render(<App/>);
