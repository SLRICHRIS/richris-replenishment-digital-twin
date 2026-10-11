import assert from 'node:assert/strict';
import { referenceFacility, graphRoute, graphRouteTrace, routeEdgeKey } from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import { routePosition, routeDirections, routeMapPoint, zoomRouteView } from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js';
import { MODEL, ROUTE_CONDITIONS } from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
const map=referenceFacility(),speed=MODEL.speed/MODEL.scale;
let checked=0;
for(const objective of ['distance','time'])for(const factor of [1,MODEL.congestedSpeed/MODEL.speed])for(const blockedEdges of [[],ROUTE_CONDITIONS.north,ROUTE_CONDITIONS.central,ROUTE_CONDITIONS.entry])for(const bay of ['bay01','bay02','bay03'])for(const bin of ['binA','binB','binC','binD'])for(const [from,to] of [[bay,bin],[bin,bay]]){
  const traced=graphRouteTrace(map,from,to,speed,factor,{objective,blockedEdges});
  assert.equal(traced.events[0].kind,'start');
  if(!traced.route){assert.equal(traced.events.at(-1).kind,'unreachable');assert.throws(()=>graphRoute(map,from,to,speed,factor,{objective,blockedEdges}),/No permitted route/);continue;}
  const route=traced.route;assert.deepEqual(route,graphRoute(map,from,to,speed,factor,{objective,blockedEdges}));
  assert.equal(traced.events.at(-1).kind,'complete');assert.equal(traced.events.at(-1).current,to);
  let previousCost=-Infinity,previousSettled=new Set();
  for(const event of traced.events){
    assert(previousSettled.size<=event.settled.length);for(const id of previousSettled)assert(event.settled.includes(id));previousSettled=new Set(event.settled);
    for(const candidate of event.frontier)assert(!previousSettled.has(candidate.id));
    if(event.current){const cost=event.costs.find(n=>n.id===event.current),value=objective==='distance'?cost.metres:cost.seconds;assert(value>=previousCost-1e-9);previousCost=value;}
    for(const edge of event.tree)assert(!blockedEdges.includes(edge.edge));
  }
  const directions=routeDirections(route);
  assert(Math.abs(directions.reduce((s,d)=>s+d.metres,0)-route.metres)<1e-8);
  assert(Math.abs(directions.reduce((s,d)=>s+d.seconds,0)-route.seconds)<1e-8);
  const start=routePosition(route,0),end=routePosition(route,route.seconds+500);
  assert(Math.hypot(start.x_m-route.nodes[0].x_m,start.y_m-route.nodes[0].y_m)<1e-9);
  assert(Math.hypot(end.x_m-route.nodes.at(-1).x_m,end.y_m-route.nodes.at(-1).y_m)<1e-9);
  let priorM=-1;
  for(let i=0;i<=20;i++){
    const p=routePosition(route,route.seconds*i/20);assert(p.metres>=priorM);priorM=p.metres;
    assert(Number.isFinite(p.x_m)&&Number.isFinite(p.y_m)&&Number.isFinite(p.heading));
    assert(route.nodes.slice(1).some((b,j)=>{const a=route.nodes[j],dx=b.x_m-a.x_m,dy=b.y_m-a.y_m,t=((p.x_m-a.x_m)*dx+(p.y_m-a.y_m)*dy)/(dx*dx+dy*dy);return t>=-1e-8&&t<=1+1e-8&&Math.hypot(a.x_m+t*dx-p.x_m,a.y_m+t*dy-p.y_m)<1e-8;}),'Playback must stay on a permitted segment');
  }
  checked++;
}
const same=graphRouteTrace(map,'bay01','bay01',speed);assert.equal(same.route.seconds,0);assert.deepEqual(routeDirections(same.route),[]);assert.equal(routePosition(same.route,4).remainingM,0);
const directed={slowBoundaryXM:4,nodes:[{id:'a',x_m:1,y_m:1},{id:'b',x_m:2,y_m:1}],edges:[{from:'a',to:'b',bidirectional:false}]};
assert(graphRouteTrace(directed,'a','b',1).route);assert.equal(graphRouteTrace(directed,'b','a',1).route,null);
const view={x:0,y:-20,w:900,h:540},rect={left:0,top:0,width:360,height:500};
const at=routeMapPoint(view,rect,100,222);assert(Math.abs(at.x-250)<1e-9&&Math.abs(at.y-180)<1e-9);
const zoomed=zoomRouteView(view,.5,at),after=routeMapPoint(zoomed,rect,100,222);assert(Math.abs(at.x-after.x)<1e-9&&Math.abs(at.y-after.y)<1e-9,'Zoom must preserve its screen anchor');
assert.equal(zoomRouteView(view,.000001).w,220);assert.equal(zoomRouteView(view,1000).w,1600);
console.log(`PASS: ${checked} route/trace/direction/playback combinations; monotonic settled costs; closed/directed/unreachable cases; zero-distance route; anchored mobile pan/zoom geometry.`);
