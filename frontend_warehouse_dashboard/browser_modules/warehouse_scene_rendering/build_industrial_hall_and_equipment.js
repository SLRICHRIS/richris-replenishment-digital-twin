// Illustrative industrial context. These fixtures are not telemetry-controlled assets.
import * as T from '../../external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_module.min.js';
import { INDUSTRIAL_FIXTURES } from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';

export function createIndustrialEnvironment({root,M,mat,box,cylinder,beam,sign,labelTexture,mergeStatic,worldPosition}){
  const walls=[],equipment=new T.Group(),structure=new T.Group(),overhead=new T.Group(),fixtures=[];
  equipment.name='Receiving, packing and service equipment';structure.name='Cutaway building frame';overhead.name='Overhead services';
  root.add(equipment,structure,overhead);
  const grey=mat('#c3c9c7',.62,.35),door=mat('#8b9694',.51,.55),safety=mat('#bf4236',.64,.18),green=mat('#315b4d',.56,.22);
  const wall=(side)=>{const group=new T.Group();group.name=side==='back'?'Loading dock wall':'Service wall';root.add(group);walls.push({group,side});return group;};
  const back=wall('back'),right=wall('right');
  box(back,M.wall,0,1.82,-4.59,14.8,3.64,.12);
  box(back,grey,0,.34,-4.51,14.6,.68,.035);
  for(let x=-7.25;x<7.4;x+=.24)box(back,M.galvanized,x,1.99,-4.522,.009,3.23,.008);
  box(back,M.dark,0,3.62,-4.48,14.72,.12,.15);
  for(const [x,title,sub] of [[-4.75,'01 / RECEIVING','INBOUND MATERIAL'],[4.67,'02 / DISPATCH','FINISHED GOODS']]){
    box(back,M.dark,x,1.23,-4.43,2.63,2.48,.19);
    box(back,door,x,1.24,-4.31,2.32,2.36,.055);
    for(let y=.14;y<2.4;y+=.105)box(back,M.galvanized,x,y,-4.271,2.3,.015,.012);
    for(const dx of [-1.25,1.25])box(back,M.yellow,x+dx,.3,-4.16,.12,.6,.14);
    sign(back,labelTexture(title,sub,'#29383b','#eef0e7'),x,2.82,-4.49,2.05,.36);
    box(back,M.dark,x,.15,-4.1,2.24,.16,.16);
  }
  sign(back,labelTexture('WH-01','MATERIAL FLOW / REPLENISHMENT','#e5e9e4','#374549'),0,3.03,-4.51,2.7,.42);
  // Exit, extinguisher and hose cabinet sit away from the robot operating envelope.
  box(back,green,-6.5,1.03,-4.42,.73,2.06,.065);
  sign(back,labelTexture('EXIT','KEEP CLEAR','#2e6b50','#eff3e8'),-6.5,2.29,-4.39,.73,.23);
  box(back,safety,-1.62,.86,-4.36,.40,.52,.18,.015);
  sign(back,labelTexture('FIRE','HOSE CABINET','#b64236','#f4e9df'),-1.62,.89,-4.25,.30,.13);
  cylinder(back,safety,-2.08,.72,-4.27,.066,.29,16);cylinder(back,M.dark,-2.08,.9,-4.27,.025,.05,12);
  box(right,M.wall,7.33,1.57,0,.12,3.14,9.22);box(right,grey,7.25,.34,0,.035,.68,9.1);
  for(let z=-4.45;z<4.6;z+=.26)box(right,M.galvanized,7.26,1.81,z,.01,2.49,.009);
  box(right,M.dark,7.22,3.14,0,.13,.12,9.1);
  // Switchgear conduits and ventilation remain against the outer service wall.
  for(const z of [-2.8,-1.2,.4,2.0]){
    box(right,M.dark,7.20,2.5,z,.025,.38,.68);
    for(let i=0;i<5;i++)box(right,M.galvanized,7.17,2.35+i*.06,z,.02,.019,.62);
  }
  box(right,M.galvanized,7.08,2.97,0,.10,.15,8.8);
  // Bolted I-section columns and a roof-edge truss make the building readable as a hall.
  function column(x,z){
    box(structure,M.galvanized,x,.035,z,.30,.07,.30);
    box(structure,M.steel,x,1.82,z,.055,3.58,.17);
    for(const dx of [-.075,.075])box(structure,M.steel,x+dx,1.82,z,.045,3.58,.23);
    for(const dx of [-.11,.11])for(const dz of [-.11,.11])cylinder(structure,M.dark,x+dx,.075,z+dz,.014,.025,8);
    box(structure,M.yellow,x,.28,z,.23,.48,.27);
    for(const y of [.17,.34])box(structure,M.dark,x,.0+y,z+.142,.245,.06,.014);
  }
  for(const x of [-7.15,-3.55,0,3.55,7.15])column(x,-4.43);
  for(const x of [-7.15,7.15])column(x,4.38);
  for(const z of [-4.43,4.38]){
    box(overhead,M.steel,0,3.52,z,14.4,.10,.12);box(overhead,M.steel,0,3.17,z,14.4,.07,.10);
    for(let x=-7.05;x<7;x+=.9)beam(overhead,M.galvanized,new T.Vector3(x,3.19,z),new T.Vector3(x+.88,3.50,z),.025,.025);
  }
  // Services are confined to the perimeter to preserve sightlines into the AMR cell.
  for(const x of [-7.02,7.02]){
    box(overhead,M.galvanized,x,3.42,0,.12,.13,8.8);
    for(const z of [-3.4,-1.1,1.2,3.45]){box(overhead,M.dark,x,3.13,z,.13,.065,1.4);box(overhead,M.light,x,3.092,z,.11,.016,1.25);}
  }
  const sprinkler=mat('#aa4439',.47,.28);
  box(overhead,sprinkler,0,3.56,-4.20,13.9,.045,.045);
  for(const x of [-5.5,-2.8,0,2.8,5.5]){cylinder(overhead,sprinkler,x,3.47,-4.20,.022,.16,12);cylinder(overhead,M.galvanized,x,3.38,-4.20,.034,.022,12);}
  // Each fixture is retained as a group for conservative world-space clearance checks.
  for(const definition of INDUSTRIAL_FIXTURES){
    const g=new T.Group();g.name=definition.id;g.position.copy(worldPosition(definition.x,definition.y));equipment.add(g);fixtures.push({definition,group:g});
    const w=definition.width/75,d=definition.depth/75,h=definition.height/75;
    if(definition.kind==='pallet'){
      for(const z of [-d*.36,0,d*.36])box(g,M.wood,0,.048,z,w,.096,.09);
      for(let i=0;i<6;i++)box(g,M.wood,-w*.41+i*w*.164,.112,0,w*.135,.035,d);
      const levels=definition.height>80?3:2,step=(h-.15)/levels;
      for(let level=0;level<levels;level++)for(const x of [-w*.23,w*.23])for(const z of [-d*.23,d*.23]){
        box(g,M.box,x,.15+step*(level+.5),z,w*.43,step*.94,d*.43,.008);
        box(g,M.tape,x,.15+step*(level+1),z,.045,.004,d*.43);
      }
      // Narrow bands suggest pallet wrap without adding a large transparent mesh.
      for(const y of [.26,h*.60,h-.05])for(const z of [-d*.47,d*.47])box(g,grey,0,y,z,w*.92,.012,.006);
      sign(g,labelTexture('WH-01','PALLET LOAD'),0,h*.52,d*.472,.26,.12);
    }else if(definition.kind==='bench'){
      const top=.82;
      for(const x of [-w*.43,w*.43])for(const z of [-d*.40,d*.40])box(g,M.galvanized,x,top/2,z,.05,top,.05);
      box(g,M.dark,0,.18,0,w*.94,.06,d*.88);box(g,grey,0,top,0,w,.05,d,.01);
      box(g,M.dark,-w*.28,top+.14,-d*.27,.07,.28,.07);
      box(g,M.dark,-w*.28,top+.31,-d*.25,.43,.25,.034,.009);box(g,M.glass,-w*.28,top+.31,-d*.229,.38,.20,.009);
      box(g,M.box,w*.22,top+.14,0,.36,.24,.36,.01);box(g,M.tape,w*.22,top+.262,0,.06,.004,.36);
      sign(g,labelTexture(definition.id==='quality-bench'?'QC-01':'PACK-01','WORKSTATION'),0,.58,d*.501,.42,.15);
      box(g,M.orange,w*.31,.29,0,.28,.36,d*.7,.01);
    }else if(definition.kind==='conveyor'){
      for(const x of [-w*.42,w*.42])for(const z of [-d*.38,d*.38])box(g,M.galvanized,x,.36,z,.045,.72,.045);
      for(const z of [-d*.46,d*.46])box(g,M.dark,0,.75,z,w,.11,.048);
      for(let i=0;i<15;i++){
        const roller=cylinder(g,M.galvanized,-w*.45+i*w*.9/14,.75,0,.038,d*.83,14);roller.rotation.x=Math.PI/2;
      }
      box(g,M.box,w*.10,.95,0,.40,.34,.36,.008);box(g,M.tape,w*.10,1.123,0,.055,.004,.36);
      box(g,M.yellow,-w*.42,.76,d*.51,.12,.13,.06);
      sign(g,labelTexture('PACKING','ROLLER TABLE'),0,.49,d*.50,.59,.16);
    }else if(definition.kind==='cart'){
      for(const x of [-w*.36,w*.36])for(const z of [-d*.35,d*.35]){const wheel=cylinder(g,M.rubber,x,.075,z,.062,.04,12);wheel.rotation.x=Math.PI/2;}
      box(g,M.steel,0,.16,0,w,.075,d,.01);box(g,M.box,0,.39,0,w*.78,.38,d*.70,.01);
      for(const x of [-w*.43,w*.43])box(g,M.galvanized,x,.61,-d*.4,.03,.77,.03);
      box(g,M.galvanized,0,.98,-d*.4,w*.86,.03,.03);
    }else{
      box(g,grey,0,h/2,0,w,h,d,.015);box(g,M.dark,0,.045,0,w*.92,.09,d*.86);
      for(const x of [-w*.24,w*.24]){box(g,M.wall,x,h*.52,d*.506,w*.47,h*.88,.018);box(g,M.dark,x+.045,h*.53,d*.525,.018,.11,.025);}
      for(let i=0;i<5;i++)box(g,M.dark,0,.22+i*.05,d*.521,w*.68,.015,.008);
      sign(g,labelTexture(definition.id==='electrical-cabinet'?'E-01':'SERVICE','AUTHORIZED ACCESS','#d8daca','#404b48'),0,h*.79,d*.526,w*.7,.17);
    }
    mergeStatic(g);
  }
  // Guard rail behind the mapped zone and at the service cabinet; never across AMR links.
  const rails=new T.Group();rails.name='Perimeter guard rails';equipment.add(rails);
  for(const [x,z,length] of [[-3.05,4.52,3.4],[3.30,4.52,5.4]]){
    for(const dx of [-length/2,0,length/2]){box(rails,M.dark,x+dx,.035,z,.15,.07,.15);cylinder(rails,M.yellow,x+dx,.40,z,.032,.80,12);}
    for(const y of [.39,.76])box(rails,M.yellow,x,y,z,length,.044,.044);
  }
  const palletJack=new T.Group();palletJack.name='Parked pallet jack';palletJack.position.copy(worldPosition(270,-50));equipment.add(palletJack);fixtures.push({definition:{id:'pallet-jack',kind:'pallet-jack'},group:palletJack});
  for(const z of [-.20,.20]){box(palletJack,M.yellow,.12,.095,z,.8,.10,.095,.015);cylinder(palletJack,M.rubber,.43,.064,z,.05,.08,12).rotation.x=Math.PI/2;}
  box(palletJack,M.yellow,-.3,.17,0,.27,.24,.55,.03);cylinder(palletJack,M.dark,-.38,.51,0,.024,.72,12);box(palletJack,M.dark,-.38,.88,0,.035,.055,.37,.014);
  mergeStatic(palletJack);mergeStatic(rails);mergeStatic(structure);mergeStatic(overhead);mergeStatic(back);mergeStatic(right);
  return{walls,equipment,structure,overhead,fixtures};
}
