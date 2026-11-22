"""Synthetic projection fixtures only; no production camera evidence is created."""
import copy
import math
import pytest
cv2=pytest.importorskip('cv2')
import numpy as np
from backend_streamlit_and_telemetry.vision_control.camera import Camera,square,REFS,CHECKS,load_config
from test_vision_execution import G


def test_reference_marker_ids_match_physical_overhead_layout():
    # Actual printed pattern observed 20 Nov 2026; origin is bottom-left.
    # Nominal inset offsets must be independently verified on the real floor.
    from backend_streamlit_and_telemetry.vision_control.contracts import WIDTH, HEIGHT
    assert set(REFS) == {1, 2, 3, 4}
    assert REFS[1][0] < REFS[4][0] and REFS[1][1] > REFS[2][1]
    assert REFS[2][0] < REFS[3][0] and REFS[3][1] < REFS[4][1]
    assert all(0 < x < WIDTH and 0 < y < HEIGHT for x,y in REFS.values())


def fixture(tmp_path,rotations=None,floor_edge=30):
    k=np.array([[1000,0,640],[0,1000,480],[0,0,1]],float)
    R=np.diag([1.,-1.,-1.]);r=cv2.Rodrigues(R)[0];t=-R@np.array([212.5,315.,920.])
    dictionary=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    def poly(world):return cv2.projectPoints(np.array(world,float),r,t,k,None)[0].reshape(-1,2)
    def marker(frame,i,x,y,z,edge,rotation=0):
        projected=poly(square(edge,rotation)+np.array([x,y,z])).astype(np.float32)
        image=cv2.aruco.generateImageMarker(dictionary,i,300)
        H=cv2.getPerspectiveTransform(np.float32([[0,0],[299,0],[299,299],[0,299]]),projected)
        warped=cv2.warpPerspective(cv2.cvtColor(image,cv2.COLOR_GRAY2BGR),H,(1280,960),borderValue=(255,255,255))
        mask=np.zeros((960,1280),np.uint8);cv2.fillConvexPoly(mask,projected.astype(np.int32),255);frame[mask>0]=warped[mask>0]
    base=np.full((960,1280,3),255,np.uint8)
    for i,(x,y) in REFS.items():marker(base,i,x,y,0,floor_edge,(rotations or {}).get(str(i),0))
    path=tmp_path/'empty.png';cv2.imwrite(str(path),base)
    p=dict(checks={c:True for c in CHECKS},geometry=G,camera_matrix=k.tolist(),distortion_coefficients=[0]*5,resolution=[1280,960],camera_height_mm=920,floor_width_mm=610,floor_length_mm=630,floor_reference_positions_mm={str(i):list(pos) for i,pos in REFS.items()},marker_edge_mm=30,marker_height_mm=50,marker_center_to_robot_center_mm=[0,0],marker_forward_offset_rad=0,max_obstacle_height_mm=40)
    if rotations is not None:p['floor_reference_rotations_deg']=rotations
    if floor_edge!=30:p['floor_reference_marker_edge_mm']=floor_edge
    frame=base.copy()
    cv2.fillConvexPoly(frame,poly([[190,270,50],[230,270,50],[230,330,50],[190,330,50]]).astype(np.int32),(70,70,70))
    marker(frame,0,210,300,50,30)
    return p,path,base,frame,poly


def test_real_aruco_pose_parallax_obstacle_and_freeze(tmp_path):
    p,path,base,frame,poly=fixture(tmp_path);tracker=Camera(p,path)
    pose,obstacles=tracker.observe(frame,10000)
    assert abs(pose['x']-210)<3 and abs(pose['y']-300)<3
    assert abs(pose['heading']-math.pi/2)<.05
    assert not obstacles
    obstacle=frame.copy();cv2.fillConvexPoly(obstacle,poly([[300,400,40],[340,400,40],[340,440,40],[300,440,40]]).astype(np.int32),(0,0,0))
    _,rects=tracker.observe(obstacle,10100)
    assert rects and any(q['x']<=300<=q['x']+q['width'] and q['y']<=400<=q['y']+q['height'] for q in rects)
    with pytest.raises(ValueError,match='stopped changing'):tracker.observe(obstacle,10601)


def test_reference_movement_and_occlusion_rejected(tmp_path):
    p,path,base,frame,_=fixture(tmp_path);tracker=Camera(p,path)
    with pytest.raises(ValueError,match='obscured'):tracker.observe(base,10000)
    shifted=cv2.warpAffine(frame,np.float32([[1,0,10],[0,1,0]]),(1280,960),borderValue=(255,255,255))
    with pytest.raises(ValueError,match='moved'):tracker.observe(shifted,10000)


def test_actual_floor_corner_order_and_minus_90_pose_recovery(tmp_path):
    rotations={str(i):-90 for i in REFS}
    # In floor X/Y, decoded corner 0 is (+X,+Y). With an overhead image's
    # downward Y axis this is top-right, followed by bottom-right/bottom-left/top-left.
    np.testing.assert_allclose(square(30,-90),[[15,15,0],[15,-15,0],[-15,-15,0],[-15,15,0]])
    p,path,base,frame,_=fixture(tmp_path,rotations)
    tracker=Camera(load_config(p),path)
    for corners in tracker.detect(base).values():
        relative=corners-corners.mean(axis=0)
        np.testing.assert_array_equal(np.sign(relative),[[1,-1],[1,1],[-1,1],[-1,-1]])
    pose,obstacles=tracker.observe(frame,10000)
    assert abs(pose['x']-210)<3 and abs(pose['y']-300)<3
    assert abs(pose['heading']-math.pi/2)<.05 and not obstacles
    wrong=copy.deepcopy(p);wrong.pop('floor_reference_rotations_deg')
    with pytest.raises(ValueError,match='reprojection'):Camera(load_config(wrong),path)


def test_mixed_floor_rotations_and_measured_edge_recover_pose_and_detect_changes(tmp_path):
    rotations={'1':-90,'2':0,'3':90,'4':180}
    p,path,base,frame,_=fixture(tmp_path,rotations,floor_edge=40)
    tracker=Camera(load_config(p),path)
    pose,obstacles=tracker.observe(frame,10000)
    assert abs(pose['x']-210)<3 and abs(pose['y']-300)<3
    assert abs(pose['heading']-math.pi/2)<.05 and not obstacles
    wrong=copy.deepcopy(p);wrong['floor_reference_marker_edge_mm']=30
    with pytest.raises(ValueError,match='reprojection'):Camera(load_config(wrong),path)
    changed=dict(rotations,**{'1':0})
    _,_,_,changed_frame,_=fixture(tmp_path,changed,floor_edge=40)
    with pytest.raises(ValueError,match='moved'):tracker.observe(changed_frame,10100)


def test_floor_reference_geometry_defaults_and_normalized_rotation(tmp_path):
    p,*_=fixture(tmp_path)
    normalized=load_config(p)
    assert normalized['floor_reference_marker_edge_mm']==30
    assert normalized['floor_reference_rotations_deg']=={str(i):0 for i in REFS}
    p['floor_reference_rotations_deg']={'1':270,'2':-450,'3':360,'4':180}
    assert load_config(p)['floor_reference_rotations_deg']=={'1':-90,'2':-90,'3':0,'4':-180}


@pytest.mark.parametrize('rotations',[
    None,[-90]*4,{'1':-90,'2':-90,'3':-90},
    {'1':-90,'2':-90,'3':-90,'4':-90,'5':0},
    {1:-90,2:-90,3:-90,4:-90},
    {'1':True,'2':-90,'3':-90,'4':-90},
    {'1':'-90','2':-90,'3':-90,'4':-90},
    {'1':math.nan,'2':-90,'3':-90,'4':-90},
    {'1':math.inf,'2':-90,'3':-90,'4':-90},
])
def test_malformed_floor_rotations_rejected(tmp_path,rotations):
    p,*_=fixture(tmp_path);p['floor_reference_rotations_deg']=rotations
    with pytest.raises(ValueError,match='rotations'):load_config(p)


@pytest.mark.parametrize('edge',[None,True,'30',math.nan,math.inf,14,121])
def test_invalid_floor_reference_marker_size_rejected(tmp_path,edge):
    p,*_=fixture(tmp_path);p['floor_reference_marker_edge_mm']=edge
    with pytest.raises(ValueError,match='floor reference marker edge'):load_config(p)


def test_example_never_claims_commissioned():
    from pathlib import Path
    example=Path(__file__).resolve().parents[2]/'backend_streamlit_and_telemetry/vision_control/example_camera_config.json'
    with pytest.raises(ValueError,match='commissioning'):load_config(example)


def test_reported_height_is_not_verified_calibration(tmp_path):
    import json
    from pathlib import Path
    path=Path(__file__).resolve().parents[2]/'backend_streamlit_and_telemetry/vision_control/example_camera_config.json'
    p=json.loads(path.read_text())
    assert (p['floor_width_mm'],p['floor_length_mm'],p['camera_height_mm'])==(610,630,1310)
    assert (p['geometry']['robot_length_mm'],p['geometry']['robot_width_mm'],p['geometry']['robot_height_mm'])==(170,155,150)
    assert p.get('reported_body_outline_robot_frame_mm') is None
    assert p['marker_height_mm']==150
    assert p['marker_edge_mm']==40
    assert p['reported_marker_offset_robot_frame_mm']==dict(reference='robot_body_center',forward=None,left=None,source='remeasure_marker_offset_before_tracking')
    assert p['marker_center_to_robot_center_mm']==[None,None]
    assert p['floor_reference_rotations_deg']=={str(i):-90 for i in REFS}
    assert p['floor_reference_marker_edge_mm']==30
    assert p['floor_reference_positions_mm']=={str(i):[None,None] for i in REFS}
    assert p['marker_forward_offset_rad'] is None
    assert not any(p['checks'].values())
    p['checks']={c:True for c in CHECKS};p['floor_width_mm']=841
    old=tmp_path/'old.json';old.write_text(json.dumps(p))
    with pytest.raises(ValueError,match='previous A0'):load_config(old)
