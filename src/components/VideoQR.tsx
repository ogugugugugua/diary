import {useMemo} from 'react';
import {qrSymbol} from '../video-link';
export function VideoQR({url,style}:{url:string;style?:React.CSSProperties}){const symbol=useMemo(()=>qrSymbol(url),[url]);return <svg role="img" aria-label="扫码观看视频" className="video-qr" style={style} viewBox={`0 0 ${symbol.size} ${symbol.size}`} shapeRendering="crispEdges"><rect width={symbol.size} height={symbol.size} fill="white"/>{symbol.rects.map((r,i)=><rect key={i} x={r.x} y={r.y} width={r.width} height="1" fill="black"/>)}</svg>;}
