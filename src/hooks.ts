import { useEffect, useState } from 'react';
import type { Asset } from './types';
import { assetURL } from './media';
export function useAssetURL(asset?:Asset,original=false):string{
  const [url,setURL]=useState(asset?.src||'');
  useEffect(()=>{let stopped=false,resource:{url:string;revoke:boolean}|undefined;setURL(asset?.src||'');
    if(asset&&!asset.missing)assetURL(asset,original).then(result=>{if(stopped){if(result.revoke)URL.revokeObjectURL(result.url);}else{resource=result;setURL(result.url);}}).catch(()=>setURL(''));
    return()=>{stopped=true;if(resource?.revoke)URL.revokeObjectURL(resource.url);};
  },[asset?.id,asset?.blobKey,asset?.thumbnailKey,asset?.src,asset?.missing,original]);return url;
}
