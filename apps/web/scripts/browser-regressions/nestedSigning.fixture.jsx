import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OwnerApprovalDialog} from '@/components/agents/OwnerApprovalDialog';
import {requestPreparedSigningReview} from '@/lib/clearsign/preparedSigningReview';
function Fixture(){const [busy,setBusy]=useState(false);const [status,setStatus]=useState('idle');return <><OwnerApprovalDialog request={{summary:'Synthetic owner approval',details:[]}} busy={busy} onCancel={()=>setStatus('owner cancelled')} onApprove={async()=>{setBusy(true);await new Promise(r=>setTimeout(r,0));try{await requestPreparedSigningReview({document:'Synthetic local review only',signer:'fixture',label:'Test',assertCurrent(){}});setStatus('continued')}catch{setStatus('cancelled')}finally{setBusy(false)}}}/><output>{status}</output></>};createRoot(document.getElementById('root')).render(<Fixture/>);
