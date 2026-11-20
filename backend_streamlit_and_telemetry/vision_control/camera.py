"""Measured overhead ArUco pose and conservative empty-floor foreground obstacles.

Controlled 610 x 630 mm laboratory floor only. Occlusion, lighting, calibration and stopping
clearance must be commissioned in person; this is not a safety-rated sensor.
"""
import math
import json
from pathlib import Path
import time
import hashlib
import cv2
import numpy as np
from .contracts import geometry,digest,WIDTH,HEIGHT,angle

CHECKS=('intrinsics_verified','floor_reference_positions_verified','empty_floor_verified',
        'marker_mount_verified','wheel_polarities_verified','pwm_speed_measured',
        'stopping_distance_measured','motor_voltage_current_verified','obstacle_detection_validated')
REFS={1:(40,40),2:(WIDTH-40,40),3:(WIDTH-40,HEIGHT-40),4:(40,HEIGHT-40)}


def square(edge):
    h=edge/2
    return np.array([[-h,h,0],[h,h,0],[h,-h,0],[-h,-h,0]],np.float64)


def load_config(path):
    p=json.loads(Path(path).read_text())
    if any(p.get('checks',{}).get(k) is not True for k in CHECKS):
        raise ValueError('Complete and verify every physical commissioning check in the private config')
    if p.get('floor_width_mm') != WIDTH or p.get('floor_length_mm') != HEIGHT:
        raise ValueError('Measure and configure the current 610 x 630 mm floor; previous A0 calibration is invalid')
    p['geometry']=geometry(p.get('geometry'))
    for name,lo,hi in (('camera_height_mm',200,3000),('marker_edge_mm',15,120),
                        ('marker_height_mm',1,300),('max_obstacle_height_mm',1,400)):
        v=p.get(name)
        if type(v) not in (int,float) or not math.isfinite(v) or not lo<=v<=hi: raise ValueError('Measure '+name)
    if p['marker_height_mm']>p['geometry']['robot_height_mm']+5 or p['max_obstacle_height_mm']>=p['camera_height_mm']/2:
        raise ValueError('Invalid marker or obstacle height envelope')
    offset=np.asarray(p.get('marker_center_to_robot_center_mm'),dtype=float)
    if offset.shape!=(2,) or not np.isfinite(offset).all() or np.linalg.norm(offset)>300: raise ValueError('Measure marker center offset')
    if type(p.get('marker_forward_offset_rad')) not in (int,float) or not math.isfinite(p['marker_forward_offset_rad']): raise ValueError('Measure marker forward alignment')
    k=np.asarray(p.get('camera_matrix'),dtype=float); dist=np.asarray(p.get('distortion_coefficients'),dtype=float)
    if k.shape!=(3,3) or not np.isfinite(k).all() or min(k[0,0],k[1,1])<=0 or dist.size not in (4,5,8,12,14) or not np.isfinite(dist).all(): raise ValueError('Measured camera intrinsics are required')
    if not isinstance(p.get('resolution'),list) or len(p['resolution'])!=2 or any(type(v) is not int or v<240 or v>4096 for v in p['resolution']): raise ValueError('Set the calibrated resolution')
    return p


class Camera:
    def __init__(self,config,background):
        self.p=config; self.k=np.array(config['camera_matrix'],float); self.dist=np.array(config['distortion_coefficients'],float)
        self.background=cv2.imread(str(background))
        if self.background is None or self.background.shape[1::-1]!=tuple(config['resolution']): raise ValueError('Capture the empty floor at the calibrated resolution')
        self.dictionary=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.detector=cv2.aruco.ArucoDetector(self.dictionary,cv2.aruco.DetectorParameters())
        self.held=np.zeros((HEIGHT,WIDTH),np.float64); self.last_hash=None; self.same_at=0
        base=cv2.undistort(self.background,self.k,self.dist)
        if 0 in self.detect(base): raise ValueError("Remove the robot before recording the empty-floor background")
        self.ref_pixels,self.r,self.t=self.reference_pose(base)
        self.R=cv2.Rodrigues(self.r)[0]; self.C=-self.R.T@self.t.reshape(3)
        if not self.C[2]>0 or abs(self.C[2]-config['camera_height_mm'])>max(20,.05*config['camera_height_mm']): raise ValueError('Measured camera height and reference pose disagree')
        floor=np.array([[0,0,0],[WIDTH,0,0],[WIDTH,HEIGHT,0],[0,HEIGHT,0]],float)
        source=cv2.projectPoints(floor,self.r,self.t,self.k,None)[0].reshape(-1,2).astype(np.float32)
        self.H=cv2.getPerspectiveTransform(source,np.float32([[0,HEIGHT],[WIDTH,HEIGHT],[WIDTH,0],[0,0]]))
        self.base=cv2.warpPerspective(base,self.H,(WIDTH,HEIGHT))
        self.config_id=digest(dict(configuration=config,background_sha256=hashlib.sha256(self.background.tobytes()).hexdigest()))

    def detect(self,image):
        corners,ids,_=self.detector.detectMarkers(image)
        if ids is not None and len(set(ids.flatten()))!=len(ids): raise ValueError("Duplicate ArUco identities in the camera view")
        return {int(i):c.reshape(4,2) for i,c in zip(ids.flatten(),corners)} if ids is not None else {}

    def reference_pose(self,image):
        found=self.detect(image)
        if any(i not in found for i in REFS): raise ValueError('All four floor reference markers must be visible')
        world=np.concatenate([square(30)+np.array([*REFS[i],0]) for i in REFS])
        pixels=np.concatenate([found[i] for i in REFS]).astype(float)
        ok,r,t=cv2.solvePnP(world,pixels,self.k,None,flags=cv2.SOLVEPNP_ITERATIVE)
        if not ok: raise ValueError('Floor camera calibration failed')
        projected=cv2.projectPoints(world,r,t,self.k,None)[0].reshape(-1,2)
        if np.max(np.linalg.norm(projected-pixels,axis=1))>2: raise ValueError('Floor reference reprojection exceeds two pixels')
        return pixels,r,t

    def observe(self,frame,now):
        if frame is None or frame.shape[1::-1]!=tuple(self.p['resolution']): raise ValueError('Camera resolution changed or frame unavailable')
        fingerprint=hashlib.sha256(frame.tobytes()).digest()
        if fingerprint!=self.last_hash: self.last_hash=fingerprint; self.same_at=now
        if now-self.same_at>500: raise ValueError('Camera frames stopped changing')
        image=cv2.undistort(frame,self.k,self.dist); found=self.detect(image)
        if any(i not in found for i in REFS) or 0 not in found: raise ValueError('Robot marker or floor reference is obscured')
        refs=np.concatenate([found[i] for i in REFS])
        if np.max(np.linalg.norm(refs-self.ref_pixels,axis=1))>2: raise ValueError('Camera or floor reference moved; recalibrate before another approval')
        # Intersect undistorted marker rays with its MEASURED horizontal plane.
        # A tiny square alone cannot reliably estimate height/tilt at ceiling range.
        pixels=np.column_stack([found[0],np.ones(4)])
        rays=(self.R.T@np.linalg.inv(self.k)@pixels.T).T
        if np.any(np.abs(rays[:,2])<1e-8): raise ValueError('Marker rays do not intersect the measured plane')
        distances=(self.p['marker_height_mm']-self.C[2])/rays[:,2]
        if np.any(distances<=0): raise ValueError('Marker plane is behind the camera')
        corners=self.C+rays*distances[:,None]
        edges=np.linalg.norm(corners-np.roll(corners,1,axis=0),axis=1)
        if np.max(np.abs(edges-self.p['marker_edge_mm']))>max(2,self.p['marker_edge_mm']*.1):
            raise ValueError('Robot marker size or planar mount differs from calibration')
        xaxis=(corners[1]-corners[0]+corners[2]-corners[3])/2
        yaxis=(corners[0]-corners[3]+corners[1]-corners[2])/2
        xaxis/=np.linalg.norm(xaxis); yaxis/=np.linalg.norm(yaxis)
        if abs(xaxis@yaxis)>.1: raise ValueError('Robot marker corners are distorted')
        center=corners.mean(axis=0)
        offset=self.p['marker_center_to_robot_center_mm']; center+=xaxis*offset[0]+yaxis*offset[1]
        heading=angle(math.atan2(yaxis[1],yaxis[0])+self.p['marker_forward_offset_rad'])
        x,y=float(center[0]),float(center[1])
        if not 0<=x<=WIDTH or not 0<=y<=HEIGHT: raise ValueError('Robot is outside the measured floor')
        warped=cv2.warpPerspective(image,self.H,(WIDTH,HEIGHT))
        delta=cv2.absdiff(warped,self.base).max(axis=2); mask=(delta>40).astype(np.uint8)*255
        # Mask the projected full 3D body, not merely the small marker.
        g=self.p['geometry']; world=[]
        for z in (0,g['robot_height_mm']):
            for a,b in ((-1,-1),(-1,1),(1,1),(1,-1)):
                dx=a*(g['robot_length_mm']/2+g['uncertainty_mm']); dy=b*(g['robot_width_mm']/2+g['uncertainty_mm'])
                world.append((x+dx*math.cos(heading)-dy*math.sin(heading),y+dx*math.sin(heading)+dy*math.cos(heading),z))
        projected=cv2.projectPoints(np.array(world,float),self.r,self.t,self.k,None)[0]
        body=cv2.perspectiveTransform(projected.astype(np.float32),self.H).reshape(-1,2)
        cv2.fillConvexPoly(mask,cv2.convexHull(body.astype(np.int32)),0)
        for i in REFS:
            polygon=cv2.perspectiveTransform(found[i].reshape(1,4,2).astype(np.float32),self.H)[0]
            cv2.fillConvexPoly(mask,polygon.astype(np.int32),0)
        if np.count_nonzero(mask)>mask.size*.30: raise ValueError('Lighting or foreground changed too much for validated obstacle detection')
        mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
        # Small components also block: no semantic AI confidence threshold discards objects.
        self.held[mask>0]=now+2000
        contours,_=cv2.findContours((self.held>now).astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        rects=[]; h=self.p['max_obstacle_height_mm']; scale=1-h/self.C[2]
        for contour in contours:
            u,v,w,hp=cv2.boundingRect(contour)
            # Union of ground projection and all heights up to the validated maximum.
            a=np.array([[u,HEIGHT-v-hp],[u+w,HEIGHT-v]],float)
            b=self.C[:2]+scale*(a-self.C[:2]); bounds=np.vstack([a,b])
            lo=np.floor(bounds.min(axis=0)/10)*10; hi=np.ceil(bounds.max(axis=0)/10)*10
            lo=np.maximum(lo,0); hi=np.minimum(hi,[WIDTH,HEIGHT])
            rects.append(dict(x=float(lo[0]),y=float(lo[1]),width=float(hi[0]-lo[0]),height=float(hi[1]-lo[1])))
        if len(rects)>64: raise ValueError('Too many foreground regions; stop and inspect the floor')
        return dict(x=x,y=y,heading=heading),rects
