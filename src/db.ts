import type { Trip, Settings } from './types';
import * as legacy from './legacy-db';
import { nativeRequest, isNativeStore, nativeBlobInfo, blobURL, putNativeBlob } from './native';
const revisions=new Map<string,number>();
export const openDatabase=legacy.openDatabase;
export async function listTrips():Promise<Trip[]>{if(!isNativeStore())return legacy.listTrips();const {trips}=await nativeRequest<{trips:Trip[]}>('/trips');for(const trip of trips)revisions.set(trip.id,trip.storageRevision||0);return trips;}
export async function getMeta<T>(key:string):Promise<T|undefined>{return isNativeStore()?(await nativeRequest<{value?:T}>('/meta?key='+encodeURIComponent(key))).value:legacy.getMeta<T>(key);}
export async function setMeta(key:string,value:unknown):Promise<void>{if(!isNativeStore())return legacy.setMeta(key,value);await nativeRequest('/meta',{key,value});}
export const saveSettings=(settings:Settings)=>setMeta('settings',{writer:{baseUrl:settings.writer.baseUrl,model:settings.writer.model},speech:{baseUrl:settings.speech.baseUrl,model:settings.speech.model},vision:settings.vision});
export async function saveTrip(trip:Trip,blobs:{key:string;blob:Blob}[]=[]):Promise<void>{
  if(!isNativeStore())return legacy.saveTrip(trip,blobs);
  for(const item of blobs)await putNativeBlob(item.key,item.blob,item.key.startsWith('media-')?'original':'retained');
  const {trip:saved}=await nativeRequest<{trip:Trip}>('/trips',{trip,expectedRevision:revisions.get(trip.id)??trip.storageRevision});revisions.set(trip.id,saved.storageRevision||0);
}
export async function getBlob(key?:string):Promise<Blob|undefined>{if(!key)return undefined;if(!isNativeStore())return legacy.getBlob(key);const info=await nativeBlobInfo(key);if(info){const response=await fetch(blobURL(key));if(response.ok)return response.blob();}return legacy.getBlob(key);}
export async function deleteTrip(trip:Trip):Promise<void>{if(!isNativeStore())return legacy.deleteTrip(trip);await nativeRequest('/trips?id='+encodeURIComponent(trip.id),undefined,'DELETE');revisions.delete(trip.id);}
