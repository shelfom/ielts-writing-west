'use client';
import {useEffect, useState} from 'react';
import {useParams} from 'next/navigation';
import {ExaminerTheatre, type TheatreData} from '@/components/theatre/ExaminerTheatre';
export default function DemoPage(){
 const {slug}=useParams<{slug:string}>();
 const [data,setData]=useState<TheatreData|null>(null);
 const [error,setError]=useState<string|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  setData(null);setError(null);
  if(!['task1','task2'].includes(slug)){setError('示例不存在 / Demo not found');return;}
  fetch(`/api/demos?slug=${encodeURIComponent(slug)}`,{signal:controller.signal,cache:'no-store'})
   .then(async response=>{if(!response.ok)throw new Error('示例暂时无法加载 / Unable to load demo');return response.json();})
   .then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
  return()=>controller.abort();
 },[slug]);
 if(data)return <ExaminerTheatre data={data} demo autoPlay={false}/>;
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f7f4ec',color:'#172020',padding:24}}><div><p>{error||'正在加载已保存的演示… / Loading saved demonstration…'}</p>{error&&<button onClick={()=>window.location.reload()}>重试 / Retry</button>}</div></main>;
}
