import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../api';

export function useKnowledgeRecords(sourceId,query='',compact=true,refresh=0) {
  const [records,setRecords]=useState([]),[next,setNext]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0),pending=useRef(false);
  useEffect(()=>{
    const version=++generation.current;
    pending.current=true;setRecords([]);setNext(null);setError('');setBusy(!!sourceId);
    if(!sourceId){pending.current=false;return;}
    const timer=setTimeout(async()=>{
      try {
        const page=await api.knowledgeSourceRecords(sourceId,null,{query,compact,limit:25});
        if(version===generation.current){setRecords(page.records);setNext(page.next);}
      }catch(e){if(version===generation.current)setError(e.message);}
      finally{if(version===generation.current){pending.current=false;setBusy(false);}}
    },250);
    return()=>{clearTimeout(timer);generation.current++;};
  },[sourceId,query,compact,refresh]);
  const loadMore=useCallback(async()=>{
    if(!sourceId||!next||pending.current)return;
    const version=generation.current;pending.current=true;setBusy(true);setError('');
    try {
      const page=await api.knowledgeSourceRecords(sourceId,next,{query,compact,limit:25});
      if(version===generation.current){setRecords(old=>[...old,...page.records.filter(r=>!old.some(o=>o.entity===r.entity))]);setNext(page.next);}
    }catch(e){if(version===generation.current)setError(e.message);}
    finally{if(version===generation.current){pending.current=false;setBusy(false);}}
  },[sourceId,next,query,compact]);
  return {records,next,busy,error,loadMore};
}
