import React, { useEffect, useState } from 'react';
import { useOverlayStore } from '../utils/store';

export function ProfileBar() {
	// what: quick profile switcher
	// input: fetch /rag/profiles
	// return: JSX select + set store profile name
	const [profiles, setProfiles] = useState<Array<{id:string;name:string}>>([]);
	const { profileName } = useOverlayStore();
	useEffect(() => {
		fetch('http://localhost:8787/rag/profiles').then(r=>r.json()).then(j=>{
			setProfiles(j.profiles || []);
		}).catch(()=>{});
	}, []);
	return (
		<div className="pane">
			<div className="title">
				<div>Profile</div>
			</div>
			<select defaultValue={profileName} style={{ width: '100%', background:'transparent', color:'white', padding:6, borderRadius:6, border:'1px solid rgba(255,255,255,0.2)'}}>
				{profiles.map(p => <option key={p.id} value={p.name} style={{ color:'black' }}>{p.name}</option>)}
			</select>
		</div>
	);
}


