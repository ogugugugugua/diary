import { useEffect, useState } from 'react';
import type { Asset } from './types';
import { assetURL } from './media';
export function useAssetURL(asset?:Asset,original=false,quality:'thumb'|'print'='thumb'):string{
  const [url,setURL]=useState(asset?.src||'');
  const [epoch,setEpoch]=useState(0);useEffect(()=>{const refresh=()=>setEpoch(n=>n+1);window.addEventListener('xingji:media-refresh',refresh);return()=>window.removeEventListener('xingji:media-refresh',refresh);},[]);
  useEffect(()=>{let stopped=false,resource:{url:string;revoke:boolean}|undefined;setURL(asset?.src||'');
    if(asset&&!asset.missing)assetURL(asset,original,quality).then(result=>{if(stopped){if(result.revoke)URL.revokeObjectURL(result.url);}else{resource=result;setURL(result.url);}}).catch(()=>setURL(''));
    return()=>{stopped=true;if(resource?.revoke)URL.revokeObjectURL(resource.url);};
  },[asset?.id,asset?.blobKey,asset?.thumbnailKey,asset?.src,asset?.missing,asset?.source?.id,asset?.source?.version,original,quality,epoch]);return url;
}
