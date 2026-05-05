import { useState, useEffect, useCallback, useRef } from "react";
import { loadFromSupabase, saveToSupabase, subscribeToState, isSupabaseReady } from "./supabase";

// ─── Categories ────────────────────────────────────────────────────────────────
const CARRIE_CATEGORIES = {
  todo:     { label: "To-Do / Errands", icon: "⚔️",  color: "#e8a838", xp: 15, gold: 10 },
  cleaning: { label: "Cleaning",        icon: "🧹",  color: "#5bc4bf", xp: 20, gold: 15 },
  cooking:  { label: "Cooking",         icon: "🍳",  color: "#e07b5a", xp: 25, gold: 20 },
  reading:  { label: "Reading",         icon: "📖",  color: "#9b72cf", xp: 30, gold: 25 },
  fitness:  { label: "Fitness",         icon: "⚡",  color: "#4caf7d", xp: 35, gold: 30 },
  learning: { label: "Learning",        icon: "🧠",  color: "#60aaff", xp: 40, gold: 35 },
};
const LILLIAN_CATEGORIES = {
  chores:  { label: "Chores",          icon: "🏠",  color: "#5bc4bf", xp: 20, gold: 15 },
  reading: { label: "Reading",         icon: "📖",  color: "#9b72cf", xp: 25, gold: 20 },
  school:  { label: "Schoolwork",      icon: "✏️",  color: "#60aaff", xp: 30, gold: 25 },
  health:  { label: "Personal Health", icon: "💚",  color: "#4caf7d", xp: 20, gold: 15 },
};

// ─── Default puzzles ───────────────────────────────────────────────────────────
const DEFAULT_CARRIE_PUZZLES = [
  { id:"c1", name:"Something Just for Me",  reward:"A guilt-free afternoon off, no obligations", pieces:9,  emoji:"✨" },
  { id:"c2", name:"The Splurge",            reward:"Buy that thing you have been putting off",   pieces:12, emoji:"💸" },
  { id:"c3", name:"Adventure Day",          reward:"A day trip or outing, your choice",          pieces:12, emoji:"🗺️" },
  { id:"c4", name:"Chef's Night Off",       reward:"Dinner out at the restaurant of your choice",pieces:9,  emoji:"🍽️" },
];
const DEFAULT_LILLIAN_PUZZLES = [
  { id:"l1", name:"Fun Night",         reward:"Pick any activity for family night",     pieces:6, emoji:"🎉" },
  { id:"l2", name:"Treat Yourself",    reward:"Pick a treat or small prize",            pieces:6, emoji:"🍦" },
  { id:"l3", name:"Adventure Unlocked",reward:"Choose the next family outing",          pieces:9, emoji:"🎠" },
  { id:"l4", name:"Screen Time Bonus", reward:"Extra 1 hour screen time, your choice",  pieces:6, emoji:"🎮" },
];
const DEFAULT_FAMILY_PUZZLE = {
  id:"fam1", name:"Family Quest Complete", reward:"Family chooses a special outing together", pieces:12, emoji:"🏰"
};

// ─── Level system ──────────────────────────────────────────────────────────────
const XP_THRESH = [0,100,250,500,900,1500,2500,4000,6000,10000];
const TITLES    = ["Novice","Apprentice","Wanderer","Adventurer","Knight","Champion","Hero","Legend","Mythic","Immortal"];
function getLevel(xp){ let l=1; for(let i=1;i<XP_THRESH.length;i++){if(xp>=XP_THRESH[i])l=i+1;else break;} return Math.min(l,XP_THRESH.length); }
function getXPProg(xp){ const l=getLevel(xp),next=XP_THRESH[l]??XP_THRESH[XP_THRESH.length-1],prev=XP_THRESH[l-1]; return {cur:xp-prev,need:next-prev,pct:Math.min(((xp-prev)/(next-prev))*100,100)}; }

// ─── Streak helpers ────────────────────────────────────────────────────────────
function todayStr(){ return new Date().toDateString(); }
function isYesterday(ds){ if(!ds) return false; const y=new Date(); y.setDate(y.getDate()-1); return ds===y.toDateString(); }
function streakMult(s){ if(s>=14) return 3; if(s>=7) return 2; if(s>=3) return 1.5; return 1; }
function streakLabel(s){ if(s>=14) return "🔥🔥🔥 On fire"; if(s>=7) return "🔥🔥 Hot streak"; if(s>=3) return "🔥 Streak"; return null; }

// ─── Local fallback ────────────────────────────────────────────────────────────
const LOCAL_KEY = "questlife_v4";
function localLoad(){ try{ const d=localStorage.getItem(LOCAL_KEY); return d?JSON.parse(d):null; }catch{ return null; } }
function localSave(s){ try{ localStorage.setItem(LOCAL_KEY,JSON.stringify(s)); }catch{} }

// ─── Profile factory ───────────────────────────────────────────────────────────
const mkProfile = (name,avatar,puzzles,quests) => ({
  name,avatar,xp:0,gold:0,streak:0,lastQuestDate:null,
  puzzleIdx:0,revealedPieces:[],completedPuzzles:[],
  quests,completedQuests:[],customPuzzles:puzzles,
});

// --- Todoist helpers using Sync API (no CORS issues) ---
const TD_SYNC="https://api.todoist.com/sync/v9";
const tdGet=async(tok,path)=>{
  const fd=new FormData();
  fd.append("token",tok);
  fd.append("sync_token","*");
  fd.append("resource_types","[\"items\"]");
  const r=await fetch(TD_SYNC+"/sync",{method:"POST",body:fd});
  if(!r.ok)throw new Error(r.status);
  const d=await r.json();
  return (d.items||[]).filter(i=>!i.checked&&!i.is_deleted).map(i=>({id:String(i.id),content:i.content,labels:i.labels||[]}));
};
const tdClose=async(tok,id)=>{
  const fd=new FormData();
  fd.append("token",tok);
  fd.append("commands",JSON.stringify([{type:"item_complete",uuid:crypto.randomUUID(),args:{id:String(id)}}]));
  return fetch(TD_SYNC+"/sync",{method:"POST",body:fd});
};
const tdAdd=async(tok,content,labels=[])=>{
  const fd=new FormData();
  fd.append("token",tok);
  fd.append("commands",JSON.stringify([{type:"item_add",uuid:crypto.randomUUID(),temp_id:crypto.randomUUID(),args:{content,labels}}]));
  const r=await fetch(TD_SYNC+"/sync",{method:"POST",body:fd});
  if(!r.ok)throw new Error(r.status);
  return r.json();
};
const LMAP={cleaning:"cleaning",cooking:"cooking",reading:"reading",fitness:"fitness",learning:"learning",errands:"todo",todo:"todo"};
function guessCategory(task,cats){const n=task.content.toLowerCase();for(const k of Object.keys(cats))if(n.includes(k))return k;for(const l of(task.labels||[])){const m=LMAP[l.toLowerCase()];if(m&&cats[m])return m;}return Object.keys(cats)[0];}

// ─── Claude flavor text ────────────────────────────────────────────────────────
async function getFlavorText(questName,category,profileName){
  const labels={todo:"errand",cleaning:"cleaning quest",cooking:"culinary challenge",reading:"scholarly pursuit",fitness:"physical trial",learning:"knowledge quest",chores:"household duty",school:"academic challenge",health:"wellness rite"};
  const prompt=`You are the narrator of a fantasy RPG life game. Write a single short, dramatic quest description (2 sentences max, under 40 words) for this real-life task: "${questName}". Frame it as an epic ${labels[category]||"quest"} for the hero ${profileName}. Be playful and fun, not overly serious. No quotation marks in your response.`;
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:120,messages:[{role:"user",content:prompt}]})});
    const d=await r.json(); return d.content?.[0]?.text?.trim()||null;
  }catch{ return null; }
}

// ─── Button style helper ───────────────────────────────────────────────────────
const sb=(extra={})=>({cursor:"pointer",border:"none",fontFamily:"inherit",borderRadius:8,padding:"6px 14px",fontSize:12,transition:"all 0.18s",...extra});

// ─── Puzzle board ──────────────────────────────────────────────────────────────
function PuzzleBoard({ puzzle, revealed, compact=false }){
  const total=puzzle.pieces,cols=3;
  const palettes=[["#1a1a2e","#0f3460","#533483","#e94560"],["#2d1b00","#8b4513","#cd853f","#f4a460"],["#0d2137","#2e7d9e","#52b2cf","#a8dadc"],["#1a0a2e","#4a1a8a","#7b2fbf","#c77dff"],["#0a2a0a","#1a5c1a","#2e8b2e","#52cf52"]];
  const pal=palettes[(puzzle.id.charCodeAt(1)||0)%palettes.length];
  const sz=compact?42:56;
  return(
    <div style={{textAlign:"center"}}>
      <div style={{display:"inline-grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:3,background:"rgba(255,255,255,0.03)",padding:6,borderRadius:10,border:"1px solid rgba(255,255,255,0.07)"}}>
        {Array.from({length:total},(_,i)=>{const on=revealed.includes(i);return(
          <div key={i} style={{width:sz,height:sz,borderRadius:6,background:on?`linear-gradient(135deg,${pal[i%pal.length]},${pal[(i+2)%pal.length]})`:"rgba(255,255,255,0.03)",border:on?"1px solid rgba(255,255,255,0.18)":"1px dashed rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:on?compact?18:22:14,transition:"all 0.45s cubic-bezier(.34,1.56,.64,1)",transform:on?"scale(1)":"scale(0.88)",boxShadow:on?"0 2px 12px rgba(0,0,0,0.5)":"none"}}>
            {on?puzzle.emoji:"❓"}
          </div>
        );})}
      </div>
      {!compact&&<div style={{color:"rgba(255,255,255,0.35)",fontSize:12,marginTop:7}}>{revealed.length} / {total} pieces</div>}
      {!compact&&<div style={{marginTop:5,display:"inline-block",background:"rgba(232,168,56,0.1)",border:"1px solid rgba(232,168,56,0.24)",borderRadius:8,padding:"4px 13px",color:"#e8a838",fontSize:12}}>🎁 {puzzle.reward}</div>}
    </div>
  );
}

// ─── Family puzzle panel ───────────────────────────────────────────────────────
function FamilyPuzzlePanel({ familyPuzzle, carrieContrib, lillianContrib, onEditReward }){
  const total=familyPuzzle.pieces;
  const allRev=[...new Set([...carrieContrib,...lillianContrib])];
  const pct=Math.round((allRev.length/total)*100);
  return(
    <div style={{background:"linear-gradient(135deg,rgba(232,168,56,0.07),rgba(155,114,207,0.07))",border:"1px solid rgba(232,168,56,0.2)",borderRadius:14,padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:12,letterSpacing:2}}>🏰 FAMILY PUZZLE</div>
          <div style={{color:"rgba(255,255,255,0.4)",fontSize:12,marginTop:2}}>{familyPuzzle.name}</div>
        </div>
        <button onClick={onEditReward} style={sb({background:"rgba(232,168,56,0.08)",border:"1px solid rgba(232,168,56,0.2)",color:"rgba(232,168,56,0.65)",fontSize:11,padding:"3px 10px"})}>✏️ Edit</button>
      </div>
      <PuzzleBoard puzzle={familyPuzzle} revealed={allRev} compact/>
      <div style={{marginTop:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",gap:14}}>
          <span style={{color:"rgba(255,255,255,0.45)",fontSize:12}}>🧙‍♀️ Carrie: {carrieContrib.length}</span>
          <span style={{color:"rgba(255,255,255,0.45)",fontSize:12}}>🧝‍♀️ Lillian: {lillianContrib.length}</span>
        </div>
        <div style={{color:"#e8a838",fontSize:13,fontFamily:"'Cinzel',serif"}}>{pct}%</div>
      </div>
      <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,marginTop:6,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#9b72cf,#e8a838)",borderRadius:2,transition:"width 0.6s ease"}}/>
      </div>
      <div style={{marginTop:8,color:"rgba(232,168,56,0.7)",fontSize:12,textAlign:"center"}}>🎁 {familyPuzzle.reward}</div>
    </div>
  );
}

// ─── Puzzle editor ─────────────────────────────────────────────────────────────
function PuzzleEditor({ puzzles, onSave, onClose }){
  const [local,setLocal]=useState(puzzles.map(p=>({...p})));
  const upd=(i,f,v)=>setLocal(p=>p.map((x,j)=>j===i?{...x,[f]:v}:x));
  const inp={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,padding:"5px 10px",color:"#eee",fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:"#130d22",border:"1px solid rgba(155,114,207,0.3)",borderRadius:16,padding:24,width:480,maxWidth:"95vw",maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:14,letterSpacing:2,marginBottom:16}}>CUSTOMIZE REWARDS</div>
        {local.map((p,i)=>(
          <div key={p.id} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:14,marginBottom:12}}>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <input value={p.emoji} onChange={e=>upd(i,"emoji",e.target.value)} style={{...inp,width:48,textAlign:"center",fontSize:22}}/>
              <input value={p.name}  onChange={e=>upd(i,"name",e.target.value)}  style={{...inp,flex:1}} placeholder="Puzzle name"/>
            </div>
            <input value={p.reward} onChange={e=>upd(i,"reward",e.target.value)} style={inp} placeholder="What do you earn?"/>
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
              <span style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>Pieces:</span>
              {[6,9,12,16].map(n=>(
                <button key={n} onClick={()=>upd(i,"pieces",n)} style={sb({background:p.pieces===n?"rgba(232,168,56,0.22)":"rgba(255,255,255,0.04)",border:`1px solid ${p.pieces===n?"rgba(232,168,56,0.5)":"rgba(255,255,255,0.1)"}`,color:p.pieces===n?"#e8a838":"rgba(255,255,255,0.4)",padding:"3px 10px",fontSize:12})}>{n}</button>
              ))}
            </div>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button onClick={()=>onSave(local)} style={sb({background:"rgba(232,168,56,0.18)",border:"1px solid rgba(232,168,56,0.42)",color:"#e8a838",fontFamily:"'Cinzel',serif",letterSpacing:1})}>SAVE</button>
          <button onClick={onClose}           style={sb({background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"})}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Single item editor (family puzzle) ───────────────────────────────────────
function SingleRewardEditor({ item, onSave, onClose }){
  const [local,setLocal]=useState({...item});
  const inp={background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:6,padding:"5px 10px",color:"#eee",fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:"#130d22",border:"1px solid rgba(232,168,56,0.3)",borderRadius:16,padding:24,width:420,maxWidth:"95vw"}}>
        <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:14,letterSpacing:2,marginBottom:16}}>EDIT FAMILY PUZZLE</div>
        <div style={{display:"flex",gap:8,marginBottom:8}}>
          <input value={local.emoji} onChange={e=>setLocal(p=>({...p,emoji:e.target.value}))} style={{...inp,width:48,textAlign:"center",fontSize:22}}/>
          <input value={local.name}  onChange={e=>setLocal(p=>({...p,name:e.target.value}))}  style={{...inp,flex:1}}/>
        </div>
        <input value={local.reward} onChange={e=>setLocal(p=>({...p,reward:e.target.value}))} style={inp} placeholder="Family reward"/>
        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
          <span style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>Pieces:</span>
          {[9,12,16,20].map(n=>(
            <button key={n} onClick={()=>setLocal(p=>({...p,pieces:n}))} style={sb({background:local.pieces===n?"rgba(232,168,56,0.22)":"rgba(255,255,255,0.04)",border:`1px solid ${local.pieces===n?"rgba(232,168,56,0.5)":"rgba(255,255,255,0.1)"}`,color:local.pieces===n?"#e8a838":"rgba(255,255,255,0.4)",padding:"3px 10px",fontSize:12})}>{n}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:8,marginTop:14}}>
          <button onClick={()=>onSave(local)} style={sb({background:"rgba(232,168,56,0.18)",border:"1px solid rgba(232,168,56,0.42)",color:"#e8a838",fontFamily:"'Cinzel',serif",letterSpacing:1})}>SAVE</button>
          <button onClick={onClose}           style={sb({background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"})}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Add quest panel ───────────────────────────────────────────────────────────
function AddQuestPanel({ cats, onAdd, onClose, todoistToken, profileName }){
  const [name,setName]=useState("");
  const [cat,setCat]=useState(Object.keys(cats)[0]);
  const [busy,setBusy]=useState(false);
  const [flavor,setFlavor]=useState(null);
  const flavorTimer=useRef(null);

  const fetchFlavor=useCallback(async(n,c)=>{
    if(!n.trim()) return;
    clearTimeout(flavorTimer.current);
    flavorTimer.current=setTimeout(async()=>{ const txt=await getFlavorText(n,c,profileName); setFlavor(txt); },700);
  },[profileName]);

  const handleName=e=>{ setName(e.target.value); setFlavor(null); fetchFlavor(e.target.value,cat); };
  const handleCat=k=>{ setCat(k); setFlavor(null); if(name.trim()) fetchFlavor(name,k); };

  const submit=async()=>{
    if(!name.trim()) return;
    setBusy(true);
    const quest={id:Date.now(),name:name.trim(),category:cat,todoistId:null,flavor:flavor||null};
    if(todoistToken){ try{const t=await tdAdd(todoistToken,name.trim(),[cat]);quest.todoistId=t.id;}catch(_){} }
    onAdd(quest); setBusy(false); onClose();
  };

  return(
    <div style={{background:"rgba(12,8,22,0.98)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:14,padding:18,marginTop:10}}>
      <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:12,letterSpacing:2,marginBottom:10}}>NEW QUEST</div>
      <input value={name} onChange={handleName} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Describe your quest..." style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.13)",borderRadius:8,padding:"8px 12px",color:"#eee",fontSize:14,fontFamily:"'Crimson Pro',Georgia,serif",boxSizing:"border-box",outline:"none"}}/>
      {flavor&&<div style={{marginTop:8,padding:"8px 12px",background:"rgba(155,114,207,0.1)",border:"1px solid rgba(155,114,207,0.22)",borderRadius:8,color:"rgba(200,180,240,0.85)",fontSize:13,fontStyle:"italic",lineHeight:1.5,animation:"pop 0.3s ease"}}>{flavor}</div>}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
        {Object.entries(cats).map(([k,c])=>(
          <button key={k} onClick={()=>handleCat(k)} style={sb({background:cat===k?`${c.color}26`:"rgba(255,255,255,0.04)",border:`1px solid ${cat===k?c.color:"rgba(255,255,255,0.1)"}`,color:cat===k?c.color:"rgba(255,255,255,0.45)",padding:"4px 10px"})}>{c.icon} {c.label}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button onClick={submit} disabled={busy} style={sb({background:"rgba(232,168,56,0.16)",border:"1px solid rgba(232,168,56,0.42)",color:"#e8a838",fontFamily:"'Cinzel',serif",letterSpacing:1})}>{busy?"ADDING...":"ADD QUEST"}{todoistToken?" + TODOIST":""}</button>
        <button onClick={onClose} style={sb({background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"})}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Quest card ────────────────────────────────────────────────────────────────
function QuestCard({ quest, cats, onComplete }){
  const [expanded,setExpanded]=useState(false);
  const cat=cats[quest.category]||Object.values(cats)[0];
  return(
    <div style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${cat.color}22`,borderLeft:`3px solid ${cat.color}`,borderRadius:10,padding:"10px 14px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:19}}>{cat.icon}</span>
        <div style={{flex:1,cursor:quest.flavor?"pointer":"default"}} onClick={()=>quest.flavor&&setExpanded(v=>!v)}>
          <div style={{color:"#eee",fontFamily:"'Crimson Pro',Georgia,serif",fontSize:15}}>{quest.name}</div>
          <div style={{display:"flex",gap:8,marginTop:2}}>
            <span style={{color:"#9b72cf",fontSize:11}}>+{cat.xp} XP</span>
            <span style={{color:"#e8a838",fontSize:11}}>+{cat.gold}g</span>
            {quest.flavor&&<span style={{color:"rgba(155,114,207,0.55)",fontSize:10}}>📜 lore</span>}
            {quest.todoistId&&<span style={{color:"rgba(219,75,75,0.7)",fontSize:10}}>● Todoist</span>}
          </div>
        </div>
        <button onClick={()=>onComplete(quest)} style={sb({background:`${cat.color}16`,border:`1px solid ${cat.color}50`,color:cat.color,fontSize:12})}>Complete</button>
      </div>
      {expanded&&quest.flavor&&(
        <div style={{marginTop:8,padding:"7px 10px",background:"rgba(155,114,207,0.08)",borderRadius:7,color:"rgba(200,180,240,0.8)",fontSize:13,fontStyle:"italic",lineHeight:1.5}}>{quest.flavor}</div>
      )}
    </div>
  );
}

// ─── Todoist modal ─────────────────────────────────────────────────────────────
function TodoistModal({ token, onSave, onClose, onSync, syncing, lastSync }){
  const [draft,setDraft]=useState(token||"");
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:"#130d22",border:"1px solid rgba(219,75,75,0.3)",borderRadius:16,padding:24,width:440,maxWidth:"95vw"}}>
        <div style={{color:"#e07b5a",fontFamily:"'Cinzel',serif",fontSize:14,letterSpacing:2,marginBottom:12}}>TODOIST SYNC</div>
        <p style={{color:"rgba(255,255,255,0.42)",fontSize:13,margin:"0 0 12px",lineHeight:1.6}}>Find your token at <strong style={{color:"rgba(255,255,255,0.65)"}}>todoist.com → Settings → Integrations → Developer</strong>.</p>
        <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="your-api-token" type="password" style={{width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.13)",borderRadius:8,padding:"8px 12px",color:"#eee",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/>
        {lastSync&&<div style={{color:"rgba(255,255,255,0.28)",fontSize:11,marginTop:8}}>Last synced: {new Date(lastSync).toLocaleTimeString()}</div>}
        <div style={{display:"flex",gap:8,marginTop:14}}>
          <button onClick={()=>onSave(draft)} style={sb({background:"rgba(219,75,75,0.18)",border:"1px solid rgba(219,75,75,0.42)",color:"#e07b5a",fontFamily:"'Cinzel',serif",letterSpacing:1})}>SAVE TOKEN</button>
          {token&&<button onClick={onSync} disabled={syncing} style={sb({background:"rgba(91,196,191,0.14)",border:"1px solid rgba(91,196,191,0.32)",color:"#5bc4bf"})}>{syncing?"Syncing...":"Sync Now"}</button>}
          <button onClick={onClose} style={sb({background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)"})}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sync status badge ─────────────────────────────────────────────────────────
function SyncBadge({ status }){
  const cfg={syncing:{color:"#60aaff",text:"⟳ Syncing"},saved:{color:"#4caf7d",text:"✓ Saved"},offline:{color:"rgba(255,255,255,0.3)",text:"○ Local only"},error:{color:"#e07b5a",text:"⚠ Sync error"}};
  const c=cfg[status]||cfg.offline;
  return <span style={{fontSize:11,color:c.color,letterSpacing:0.5}}>{c.text}</span>;
}

// ─── Profile view ──────────────────────────────────────────────────────────────
function ProfileView({ profile, cats, onUpdate, todoistToken, onSyncTodoist, syncing, onFamilyPiece }){
  const [showAdd,setShowAdd]=useState(false);
  const [showEditor,setShowEditor]=useState(false);
  const [flash,setFlash]=useState(null);

  const level=getLevel(profile.xp);
  const prog=getXPProg(profile.xp);
  const puzzles=profile.customPuzzles;
  const puzzle=puzzles[profile.puzzleIdx%puzzles.length];
  const revealed=profile.revealedPieces;
  const mult=streakMult(profile.streak);

  const completeQuest=useCallback((quest)=>{
    const cat=cats[quest.category]||Object.values(cats)[0];
    const newXP=profile.xp+Math.round(cat.xp*mult);
    const newGold=profile.gold+Math.round(cat.gold*mult);
    const today=todayStr();
    let newStreak=profile.streak,newLastDate=profile.lastQuestDate;
    if(profile.lastQuestDate===today){}
    else if(isYesterday(profile.lastQuestDate)){newStreak=profile.streak+1;newLastDate=today;}
    else{newStreak=1;newLastDate=today;}
    const total=puzzle.pieces;
    const free=Array.from({length:total},(_,i)=>i).filter(i=>!revealed.includes(i));
    let newRev=[...revealed];
    if(free.length>0) newRev=[...revealed,free[Math.floor(Math.random()*free.length)]];
    let newIdx=profile.puzzleIdx,newComp=[...profile.completedPuzzles],done=false;
    if(newRev.length>=total){done=true;newComp=[...newComp,{id:puzzle.id,reward:puzzle.reward,completedAt:Date.now()}];newIdx=profile.puzzleIdx+1;newRev=[];}
    onFamilyPiece(profile.name);
    if(todoistToken&&quest.todoistId) tdClose(todoistToken,quest.todoistId).catch(()=>{});
    const bonusTxt=mult>1?` (${mult}x streak bonus!)`:"";
    setFlash(done?{type:"puzzle",text:`🎉 PUZZLE COMPLETE! Reward: ${puzzle.reward}`}:{type:"xp",text:`+${Math.round(cat.xp*mult)} XP  +${Math.round(cat.gold*mult)}g  🧩 Piece revealed!${bonusTxt}`});
    setTimeout(()=>setFlash(null),4000);
    onUpdate({...profile,xp:newXP,gold:newGold,streak:newStreak,lastQuestDate:newLastDate,quests:profile.quests.filter(q=>q.id!==quest.id),completedQuests:[...profile.completedQuests,{...quest,completedAt:Date.now()}],revealedPieces:newRev,puzzleIdx:newIdx,completedPuzzles:newComp});
  },[profile,cats,puzzle,revealed,mult,todoistToken,onUpdate,onFamilyPiece]);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {showEditor&&<PuzzleEditor puzzles={puzzles} onSave={p=>{onUpdate({...profile,customPuzzles:p});setShowEditor(false);}} onClose={()=>setShowEditor(false)}/>}

      {/* Hero */}
      <div style={{background:"linear-gradient(135deg,rgba(155,114,207,0.11),rgba(232,168,56,0.07))",border:"1px solid rgba(155,114,207,0.18)",borderRadius:14,padding:"16px 18px",display:"flex",alignItems:"center",gap:14}}>
        <div style={{fontSize:44}}>{profile.avatar}</div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
            <span style={{color:"#fff",fontFamily:"'Cinzel',serif",fontSize:19}}>{profile.name}</span>
            <span style={{color:"#9b72cf",fontSize:11,letterSpacing:2,textTransform:"uppercase"}}>{TITLES[level-1]}</span>
            <span style={{background:"rgba(232,168,56,0.16)",border:"1px solid rgba(232,168,56,0.35)",color:"#e8a838",borderRadius:20,padding:"1px 8px",fontSize:11,fontFamily:"'Cinzel',serif"}}>Lv.{level}</span>
          </div>
          <div style={{display:"flex",gap:12,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{color:"#e8a838",fontSize:13}}>⭐ {profile.xp} XP</span>
            <span style={{color:"#f0c040",fontSize:13}}>💰 {profile.gold}g</span>
            <span style={{color:"#5bc4bf",fontSize:13}}>🧩 {profile.completedPuzzles.length} done</span>
            {profile.streak>0&&<span style={{color:"#ff7043",fontSize:13}}>🔥 {profile.streak} day{mult>1?` (${mult}x)`:""}</span>}
          </div>
          {profile.streak>0&&streakLabel(profile.streak)&&<div style={{marginTop:3,color:"rgba(255,112,67,0.7)",fontSize:11}}>{streakLabel(profile.streak)}</div>}
          <div style={{marginTop:8}}>
            <div style={{display:"flex",justifyContent:"space-between",color:"rgba(255,255,255,0.28)",fontSize:10,marginBottom:3}}>
              <span>Next level</span><span>{prog.cur} / {prog.need} XP</span>
            </div>
            <div style={{height:5,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${prog.pct}%`,background:"linear-gradient(90deg,#9b72cf,#e8a838)",borderRadius:3,transition:"width 0.6s ease"}}/>
            </div>
          </div>
        </div>
      </div>

      {flash&&<div style={{background:flash.type==="puzzle"?"rgba(232,168,56,0.2)":"rgba(75,200,120,0.15)",border:`1px solid ${flash.type==="puzzle"?"rgba(232,168,56,0.5)":"rgba(75,200,120,0.38)"}`,borderRadius:10,padding:"10px 16px",color:flash.type==="puzzle"?"#e8a838":"#7fde9f",fontFamily:"'Cinzel',serif",fontSize:13,textAlign:"center",animation:"pop 0.3s cubic-bezier(.34,1.56,.64,1)"}}>{flash.text}</div>}

      {/* Personal puzzle */}
      <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:2}}>CURRENT PUZZLE: {puzzle.name}</div>
          <button onClick={()=>setShowEditor(true)} style={sb({background:"rgba(232,168,56,0.08)",border:"1px solid rgba(232,168,56,0.2)",color:"rgba(232,168,56,0.6)",fontSize:11,padding:"3px 10px"})}>✏️ Edit Rewards</button>
        </div>
        <PuzzleBoard puzzle={puzzle} revealed={revealed}/>
      </div>

      {/* Quests */}
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{color:"#9b72cf",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:2}}>ACTIVE QUESTS ({profile.quests.length})</div>
          <div style={{display:"flex",gap:6}}>
            {todoistToken&&<button onClick={onSyncTodoist} disabled={syncing} style={sb({background:"rgba(219,75,75,0.1)",border:"1px solid rgba(219,75,75,0.28)",color:"#e07b5a",fontSize:11,padding:"4px 10px"})}>{syncing?"⟳...":"⟳ Todoist"}</button>}
            <button onClick={()=>setShowAdd(v=>!v)} style={sb({background:"rgba(155,114,207,0.12)",border:"1px solid rgba(155,114,207,0.3)",color:"#9b72cf",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:1,padding:"4px 12px"})}>
          </div>
        </div>
        {showAdd&&<AddQuestPanel cats={cats} onAdd={q=>onUpdate({...profile,quests:[...profile.quests,q]})} onClose={()=>setShowAdd(false)} todoistToken={todoistToken} profileName={profile.name}/>}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:8}}>
          {profile.quests.length===0&&<div style={{color:"rgba(255,255,255,0.2)",fontSize:13,textAlign:"center",padding:"24px 0",fontStyle:"italic"}}>No active quests. Add one or sync from Todoist.</div>}
          {profile.quests.map(q=><QuestCard key={q.id} quest={q} cats={cats} onComplete={completeQuest}/>)}
        </div>
      </div>

      {profile.completedQuests.length>0&&(
        <div>
          <div style={{color:"rgba(255,255,255,0.18)",fontFamily:"'Cinzel',serif",fontSize:10,letterSpacing:2,marginBottom:8}}>RECENTLY COMPLETED</div>
          {profile.completedQuests.slice().reverse().slice(0,5).map(q=>{
            const cat=cats[q.category]||Object.values(cats)[0];
            return <div key={q.id+(q.completedAt||0)} style={{display:"flex",alignItems:"center",gap:10,padding:"4px 10px",opacity:0.4}}>
              <span style={{fontSize:13}}>{cat.icon}</span>
              <span style={{color:"rgba(255,255,255,0.4)",fontSize:13,textDecoration:"line-through",fontFamily:"'Crimson Pro',Georgia,serif"}}>{q.name}</span>
              <span style={{marginLeft:"auto",color:"#4caf7d",fontSize:11}}>✓</span>
            </div>;
          })}
        </div>
      )}

      {profile.completedPuzzles.length>0&&(
        <div style={{background:"rgba(232,168,56,0.05)",border:"1px solid rgba(232,168,56,0.13)",borderRadius:12,padding:14}}>
          <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:2,marginBottom:8}}>REWARDS EARNED 🏆</div>
          {profile.completedPuzzles.map((p,i)=>(
            <div key={i} style={{color:"rgba(255,255,255,0.52)",fontSize:13,marginBottom:4}}>🎁 {p.reward}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Initial state ─────────────────────────────────────────────────────────────
const INITIAL_STATE={
  profiles:{
    carrie:mkProfile("Carrie","🧙‍♀️",DEFAULT_CARRIE_PUZZLES,[
      {id:1,name:"Sweep the kitchen floor",  category:"cleaning",todoistId:null,flavor:null},
      {id:2,name:"Read 20 pages",            category:"reading", todoistId:null,flavor:null},
      {id:3,name:"Prep dinner",              category:"cooking", todoistId:null,flavor:null},
    ]),
    lillian:mkProfile("Lillian Mercer","🧝‍♀️",DEFAULT_LILLIAN_PUZZLES,[
      {id:4,name:"Make my bed",              category:"chores",  todoistId:null,flavor:null},
      {id:5,name:"Read one chapter",         category:"reading", todoistId:null,flavor:null},
      {id:6,name:"Practice spelling words",  category:"school",  todoistId:null,flavor:null},
      {id:7,name:"Drink 6 glasses of water", category:"health",  todoistId:null,flavor:null},
    ]),
  },
  familyPuzzle:DEFAULT_FAMILY_PUZZLE,
  carrieContrib:[],
  lillianContrib:[],
  familyCompleted:[],
  todoistToken:"",
  lastSync:null,
};

// ─── Root app ──────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("carrie");
  const [showTD,setShowTD]=useState(false);
  const [showFamEdit,setShowFamEdit]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [syncStatus,setSyncStatus]=useState("offline");
  const [state,setState]=useState(()=>localLoad()||INITIAL_STATE);
  const saveTimer=useRef(null);
  const isRemote=useRef(false);

  // Load from Supabase on mount
  useEffect(()=>{
    if(!isSupabaseReady()){setSyncStatus("offline");return;}
    loadFromSupabase().then(remote=>{
      if(remote){setState(remote);isRemote.current=true;setSyncStatus("saved");}
    });
    const unsub=subscribeToState(remote=>{
      setState(remote);
      localSave(remote);
      setSyncStatus("saved");
    });
    return unsub;
  },[]);

  // Debounced save on state change
  useEffect(()=>{
    localSave(state);
    if(!isSupabaseReady()){setSyncStatus("offline");return;}
    setSyncStatus("syncing");
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      try{ await saveToSupabase(state); setSyncStatus("saved"); }
      catch{ setSyncStatus("error"); }
    },1200);
  },[state]);

  const upd=useCallback((key,data)=>setState(s=>({...s,profiles:{...s.profiles,[key]:data}})),[]);

  const addFamilyPiece=useCallback((profileName)=>{
    setState(s=>{
      const fp=s.familyPuzzle;
      const total=fp.pieces;
      const allRev=[...new Set([...s.carrieContrib,...s.lillianContrib])];
      if(allRev.length>=total){
        return{...s,familyPuzzle:{...fp,id:`fam${Date.now()}`},carrieContrib:[],lillianContrib:[],familyCompleted:[...s.familyCompleted,{reward:fp.reward,completedAt:Date.now()}]};
      }
      const free=Array.from({length:total},(_,i)=>i).filter(i=>!allRev.includes(i));
      if(!free.length) return s;
      const pick=free[Math.floor(Math.random()*free.length)];
      if(profileName==="Carrie") return{...s,carrieContrib:[...s.carrieContrib,pick]};
      return{...s,lillianContrib:[...s.lillianContrib,pick]};
    });
  },[]);

  const syncTodoist=useCallback(async()=>{
    if(!state.todoistToken) return;
    setSyncing(true);
    try{
      const tasks=await tdGet(state.todoistToken,"/tasks");
      const prof=state.profiles.carrie;
      const exIds=new Set([...prof.quests.map(q=>String(q.todoistId)),...prof.completedQuests.map(q=>String(q.todoistId))].filter(Boolean));
      const fresh=tasks.filter(t=>!exIds.has(String(t.id))).map(t=>({id:Date.now()+Math.random(),name:t.content,category:guessCategory(t,CARRIE_CATEGORIES),todoistId:String(t.id),flavor:null}));
      if(fresh.length>0) upd("carrie",{...prof,quests:[...prof.quests,...fresh]});
      setState(s=>({...s,lastSync:Date.now()}));
    }catch(_){alert("Todoist sync failed. Check your API token.");}
    setSyncing(false);
  },[state.todoistToken,state.profiles.carrie,upd]);

  useEffect(()=>{
    const l=document.createElement("link");
    l.href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap";
    l.rel="stylesheet"; document.head.appendChild(l);
  },[]);

  const cats=tab==="carrie"?CARRIE_CATEGORIES:LILLIAN_CATEGORIES;
  const allFamRev=[...new Set([...state.carrieContrib,...state.lillianContrib])];
  const famPct=Math.round((allFamRev.length/state.familyPuzzle.pieces)*100);

  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#090512 0%,#100c1c 45%,#0c1318 100%)",fontFamily:"'Crimson Pro',Georgia,serif",color:"#eee",paddingBottom:56}}>
      <style>{`@keyframes pop{from{opacity:0;transform:translateY(-8px) scale(0.95)}to{opacity:1;transform:none}}*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(155,114,207,0.3);border-radius:2px}input::placeholder{color:rgba(255,255,255,0.22)}`}</style>

      <div style={{background:"rgba(9,5,18,0.93)",borderBottom:"1px solid rgba(155,114,207,0.16)",padding:"18px 20px 0",position:"sticky",top:0,zIndex:10,backdropFilter:"blur(14px)"}}>
        <div style={{maxWidth:620,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:26}}>⚔️</span>
              <div>
                <h1 style={{margin:0,fontFamily:"'Cinzel',serif",fontSize:20,color:"#e8a838",letterSpacing:2,lineHeight:1}}>QUEST LIFE</h1>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{color:"rgba(155,114,207,0.55)",fontSize:10,letterSpacing:3,textTransform:"uppercase"}}>Mercer Family</div>
                  <SyncBadge status={syncStatus}/>
                </div>
              </div>
            </div>
            <button onClick={()=>setShowTD(true)} style={sb({background:state.todoistToken?"rgba(219,75,75,0.16)":"rgba(255,255,255,0.05)",border:`1px solid ${state.todoistToken?"rgba(219,75,75,0.42)":"rgba(255,255,255,0.11)"}`,color:state.todoistToken?"#e07b5a":"rgba(255,255,255,0.32)",fontSize:11,padding:"5px 12px"})}>
              {state.todoistToken?"● Todoist":"Connect Todoist"}
            </button>
          </div>
          <div style={{display:"flex",gap:2}}>
            {[["carrie","🧙‍♀️","Carrie"],["lillian","🧝‍♀️","Lillian"],["family","🏰","Family"]].map(([key,em,lbl])=>{
              const active=tab===key;
              return <button key={key} onClick={()=>setTab(key)} style={{flex:1,background:active?"rgba(155,114,207,0.1)":"transparent",border:"none",borderBottom:`2px solid ${active?"#9b72cf":"transparent"}`,color:active?"#9b72cf":"rgba(255,255,255,0.28)",padding:"8px 0",cursor:"pointer",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:1.5,transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
                <span>{em}</span><span>{lbl.toUpperCase()}</span>
                {key!=="family"&&<span style={{background:"rgba(232,168,56,0.16)",color:"#e8a838",borderRadius:10,padding:"0 6px",fontSize:10}}>Lv.{getLevel(state.profiles[key].xp)}</span>}
                {key==="family"&&<span style={{background:"rgba(232,168,56,0.16)",color:"#e8a838",borderRadius:10,padding:"0 6px",fontSize:10}}>{famPct}%</span>}
              </button>;
            })}
          </div>
        </div>
      </div>

      {showTD&&<TodoistModal token={state.todoistToken} onSave={t=>{setState(s=>({...s,todoistToken:t}));setShowTD(false);}} onClose={()=>setShowTD(false)} onSync={syncTodoist} syncing={syncing} lastSync={state.lastSync}/>}
      {showFamEdit&&<SingleRewardEditor item={state.familyPuzzle} onSave={fp=>{setState(s=>({...s,familyPuzzle:{...fp}}));setShowFamEdit(false);}} onClose={()=>setShowFamEdit(false)}/>}

      <div style={{maxWidth:620,margin:"0 auto",padding:"20px 16px 0"}}>
        {tab==="family"&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <FamilyPuzzlePanel familyPuzzle={state.familyPuzzle} carrieContrib={state.carrieContrib} lillianContrib={state.lillianContrib} onEditReward={()=>setShowFamEdit(true)}/>
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:16}}>
              <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:2,marginBottom:14}}>LEADERBOARD</div>
              {[["carrie","🧙‍♀️"],["lillian","🧝‍♀️"]].sort((a,b)=>state.profiles[b[0]].xp-state.profiles[a[0]].xp).map(([key,em],rank)=>{
                const p=state.profiles[key];
                return <div key={key} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:"rgba(255,255,255,0.03)",borderRadius:10,marginBottom:8,border:"1px solid rgba(255,255,255,0.07)"}}>
                  <span style={{fontSize:22,width:28}}>{rank===0?"🥇":"🥈"}</span>
                  <span style={{fontSize:32}}>{em}</span>
                  <div style={{flex:1}}>
                    <div style={{color:"#fff",fontFamily:"'Cinzel',serif",fontSize:14}}>{p.name}</div>
                    <div style={{display:"flex",gap:10,marginTop:2}}>
                      <span style={{color:"#e8a838",fontSize:12}}>Lv.{getLevel(p.xp)}</span>
                      <span style={{color:"rgba(255,255,255,0.45)",fontSize:12}}>⭐ {p.xp} XP</span>
                      {p.streak>0&&<span style={{color:"#ff7043",fontSize:12}}>🔥 {p.streak}</span>}
                    </div>
                  </div>
                  <div style={{color:"rgba(255,255,255,0.4)",fontSize:12,textAlign:"right"}}>
                    <div>💰 {p.gold}g</div>
                    <div>🧩 {p.completedPuzzles.length} puzzles</div>
                  </div>
                </div>;
              })}
            </div>
            {state.familyCompleted.length>0&&(
              <div style={{background:"rgba(232,168,56,0.05)",border:"1px solid rgba(232,168,56,0.13)",borderRadius:12,padding:14}}>
                <div style={{color:"#e8a838",fontFamily:"'Cinzel',serif",fontSize:11,letterSpacing:2,marginBottom:8}}>FAMILY REWARDS EARNED 🏆</div>
                {state.familyCompleted.map((r,i)=>(
                  <div key={i} style={{color:"rgba(255,255,255,0.52)",fontSize:13,marginBottom:4}}>🎁 {r.reward}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab!=="family"&&(
          <ProfileView key={tab} profile={state.profiles[tab]} cats={cats} onUpdate={d=>upd(tab,d)} todoistToken={tab==="carrie"?state.todoistToken:""} onSyncTodoist={syncTodoist} syncing={syncing} onFamilyPiece={addFamilyPiece}/>
        )}
      </div>
    </div>
  );
}
