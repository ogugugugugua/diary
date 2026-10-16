import QRCode from 'qrcode';
export function videoLink(value:unknown):string|undefined {
 if(value===undefined||value==='')return;
 if(typeof value!=='string')throw new Error('视频观看链接必须是HTTPS网址。');
 const input=value.trim();if(!input)return;
 let url:URL;try{url=new URL(input);}catch{throw new Error('请输入有效的视频观看链接。');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||!host.includes('.')||/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||host.includes(':')||/(^|\.)(localhost|local|internal|lan|test|invalid)$/.test(host)||url.username||url.password)throw new Error('请使用可供读者访问的公开HTTPS观看链接，不支持本机路径或含账号密码的网址。');
 if([...url.searchParams.keys()].some(k=>/^(access_token|api_key|apikey|authorization|signature|sig|expires|x-amz-.+|x-goog-.+)$/i.test(k)))throw new Error('请使用长期观看页面链接，不要使用带密钥或临时签名的下载链接。');
 if(new TextEncoder().encode(url.href).length>500)throw new Error('观看链接过长（最多500字节），请使用较短的长期分享链接。');
 return url.href;
}
export function frameTime(time:number,duration:number):number {
 if(!Number.isFinite(time)||time<0)throw new Error('请输入有效的关键帧时间。');
 if(!Number.isFinite(duration)||duration<=0)throw new Error('无法读取视频时长。');
 return Math.min(time,Math.max(0,duration-.05));
}
// Four white modules on every side are retained in both SVG preview and vector PDF.
export function qrSymbol(link:string){const url=videoLink(link);if(!url)throw new Error('视频链接为空。');const qr=QRCode.create(url,{errorCorrectionLevel:'M'});const size=qr.modules.size+8,rects:{x:number;y:number;width:number}[]=[];
 for(let y=0;y<qr.modules.size;y++){let start=-1;for(let x=0;x<=qr.modules.size;x++){const black=x<qr.modules.size&&qr.modules.data[y*qr.modules.size+x];if(black&&start<0)start=x;if(!black&&start>=0){rects.push({x:start+4,y:y+4,width:x-start});start=-1;}}}
 return {size,rects};
}
