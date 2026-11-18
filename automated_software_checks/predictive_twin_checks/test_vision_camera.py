"""Synthetic projection fixtures only; no production camera evidence is created."""
import copy
import math
import pytest
cv2=pytest.importorskip('cv2')
import numpy as np
from backend_streamlit_and_telemetry.vision_control.camera import Camera,square,REFS,CHECKS,load_config
from test_vision_execution import G


def fixture(tmp_path):
    k=np.array([[1000,0,640],[0,1000,480],[0,0,1]],float)
    R=np.diag([1.,-1.,-1.]);r=cv2.Rodrigues(R)[0];t=-R@np.array([420.5,594.5,1500.])
    dictionary=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    def poly(world):return cv2.projectPoints(np.array(world,float),r,t,k,None)[0].reshape(-1,2)
    def marker(frame,i,x,y,z,edge):
        projected=poly(square(edge)+np.array([x,y,z])).astype(np.float32)
        image=cv2.aruco.generateImageMarker(dictionary,i,300)
        H=cv2.getPerspectiveTransform(np.float32([[0,0],[299,0],[299,299],[0,299]]),projected)
        warped=cv2.warpPerspective(cv2.cvtColor(image,cv2.COLOR_GRAY2BGR),H,(1280,960),borderValue=(255,255,255))
        mask=np.zeros((960,1280),np.uint8);cv2.fillConvexPoly(mask,projected.astype(np.int32),255);frame[mask>0]=warped[mask>0]
    base=np.full((960,1280,3),255,np.uint8)
    for i,(x,y) in REFS.items():marker(base,i,x,y,0,30)
    path=tmp_path/'empty.png';cv2.imwrite(str(path),base)
    p=dict(checks={c:True for c in CHECKS},geometry=G,camera_matrix=k.tolist(),distortion_coefficients=[0]*5,resolution=[1280,960],camera_height_mm=1500,marker_edge_mm=30,marker_height_mm=50,marker_center_to_robot_center_mm=[0,0],marker_forward_offset_rad=0,max_obstacle_height_mm=40)
    frame=base.copy()
    cv2.fillConvexPoly(frame,poly([[270,260,50],[330,260,50],[330,340,50],[270,340,50]]).astype(np.int32),(70,70,70))
    marker(frame,0,300,300,50,30)
    return p,path,base,frame,poly


def test_real_aruco_pose_parallax_obstacle_and_freeze(tmp_path):
    p,path,base,frame,poly=fixture(tmp_path);tracker=Camera(p,path)
    pose,obstacles=tracker.observe(frame,10000)
    assert abs(pose['x']-300)<3 and abs(pose['y']-300)<3
    assert abs(pose['heading']-math.pi/2)<.05
    assert not obstacles
    obstacle=frame.copy();cv2.fillConvexPoly(obstacle,poly([[600,600,40],[650,600,40],[650,650,40],[600,650,40]]).astype(np.int32),(0,0,0))
    _,rects=tracker.observe(obstacle,10100)
    assert rects and any(q['x']<=600<=q['x']+q['width'] and q['y']<=600<=q['y']+q['height'] for q in rects)
    with pytest.raises(ValueError,match='stopped changing'):tracker.observe(obstacle,10601)


def test_reference_movement_and_occlusion_rejected(tmp_path):
    p,path,base,frame,_=fixture(tmp_path);tracker=Camera(p,path)
    with pytest.raises(ValueError,match='obscured'):tracker.observe(base,10000)
    shifted=cv2.warpAffine(frame,np.float32([[1,0,10],[0,1,0]]),(1280,960),borderValue=(255,255,255))
    with pytest.raises(ValueError,match='moved'):tracker.observe(shifted,10000)


def test_example_never_claims_commissioned():
    from pathlib import Path
    example=Path(__file__).resolve().parents[2]/'backend_streamlit_and_telemetry/vision_control/example_camera_config.json'
    with pytest.raises(ValueError,match='commissioning'):load_config(example)
