"""Attended camera preparation. Never publishes telemetry or motor commands."""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    m=sub.add_parser('markers'); m.add_argument('--robot-edge-mm',type=float,required=True); m.add_argument('--output',default='runtime/aruco-markers.html')
    for name in ('intrinsics','background'):
        c=sub.add_parser(name); c.add_argument('--camera',type=int,default=0); c.add_argument('--width',type=int,default=1280); c.add_argument('--height',type=int,default=720)
        c.add_argument('--output',required=True)
    args=parser.parse_args(); dest=Path(args.output); dest.parent.mkdir(parents=True,exist_ok=True)
    dictionary=cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    if args.command=='markers':
        if not 15<=args.robot_edge_mm<=120: raise SystemExit('Robot marker edge must be 15..120 mm')
        import base64
        parts=['<!doctype html><title>AMR ArUco markers</title><style>@page{size:A4;margin:20mm}body{font-family:Arial}section{break-inside:avoid;margin:10mm 0}img{display:block;margin:6mm;image-rendering:pixelated}</style><h1>Print at 100% actual size</h1><p>The black outer square is the measured edge. Verify it with a ruler. Keep white margins. All floor marker tops point toward +Y.</p>']
        for i in range(5):
            size=args.robot_edge_mm if i==0 else 30
            image=cv2.aruco.generateImageMarker(dictionary,i,600)
            encoded=cv2.imencode('.png',image)[1].tobytes()
            data=base64.b64encode(encoded).decode()
            parts.append(f'<section><p>DICT_4X4_50 · ID {i} · black edge {size:g} mm</p><img style="width:{size:g}mm;height:{size:g}mm" src="data:image/png;base64,{data}"></section>')
        dest.write_text('\n'.join(parts)); print('Marker print sheet saved:',dest); return
    cap=cv2.VideoCapture(args.camera)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,args.width); cap.set(cv2.CAP_PROP_FRAME_HEIGHT,args.height)
    detector=cv2.aruco.ArucoDetector(dictionary,cv2.aruco.DetectorParameters())
    world=np.zeros((9*6,3),np.float32); world[:,:2]=np.mgrid[0:9,0:6].T.reshape(-1,2)*25
    objects=[]; images=[]; resolution=None
    print('Intrinsics: show a 9 x 6 INNER-corner checkerboard, 25 mm squares. SPACE captures a varied view; C calibrates after 20 views. Q exits. Background: empty floor and IDs 1..4 only; C captures.')
    try:
        while True:
            ok,frame=cap.read()
            if not ok: raise SystemExit('Camera frame unavailable')
            resolution=frame.shape[1::-1]; gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY); show=frame.copy()
            found,corners=cv2.findChessboardCorners(gray,(9,6)) if args.command=='intrinsics' else (False,None)
            if found: cv2.drawChessboardCorners(show,(9,6),corners,found)
            cv2.imshow('AMR camera preparation',show); k=cv2.waitKey(30)&255
            if k in (ord('q'),27): return
            if args.command=='intrinsics':
                if k==32 and found:
                    refined=cv2.cornerSubPix(gray,corners,(11,11),(-1,-1),(cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER,30,.001))
                    images.append(refined); objects.append(world.copy()); print('Views:',len(images))
                if k==ord('c') and len(images)>=20:
                    rms,matrix,dist,_,_=cv2.calibrateCamera(objects,images,resolution,None,None)
                    if rms>1: print('Reprojection error exceeds 1 px; capture better varied views'); continue
                    dest.write_text(json.dumps(dict(camera_matrix=matrix.tolist(),distortion_coefficients=dist.flatten().tolist(),resolution=list(resolution),calibration_rms_px=rms,calibration_views=len(images)),indent=2))
                    print('Intrinsics saved; validate ruler distances across the A0 floor before marking verified'); return
            elif k==ord('c'):
                _,ids,_=detector.detectMarkers(frame); visible=set(ids.flatten()) if ids is not None else set()
                if 0 in visible or not {1,2,3,4}<=visible: print('Remove robot and expose all four floor references'); continue
                if not cv2.imwrite(str(dest),frame): raise SystemExit('Could not save empty-floor frame')
                print('Empty floor saved. Verify no obstacle is present, including outside marker areas'); return
    finally: cap.release(); cv2.destroyAllWindows()


if __name__=='__main__': main()
