import s from "../routes/LandingPage.module.css";

/** Original diagrams of relationships, not execution or readiness claims. */
export function ProductScene({ scene }: { scene: string }) {
  return <div className={s.productScene} data-scene={scene} aria-hidden="true">
    <div className={s.sceneCaption}><span>C / {scene}</span><span>{scene === "01" ? "SHARED CONTEXT" : scene === "02" ? "SEPARATE PIECES" : "DEFINED AUTHORITY"}</span></div>
    <svg viewBox="0 0 520 300" fill="none" focusable="false">
      {scene === "01" ? <>
        <ellipse cx="260" cy="152" rx="209" ry="112" stroke="#394337" strokeDasharray="2 9" />
        <path className={s.sceneConnection} d="M94 85L219 122M426 85L303 122M94 221L219 184M426 221L303 184" stroke="#879b80" />
        {[[94,85],[426,85],[94,221],[426,221]].map(([x,y],i) => <g key={i}><circle cx={x} cy={y} r="28" fill="#151b15" stroke="#879b80" /><circle cx={x} cy={y-6} r="7" stroke="#b9c9b2" /><path d={`M${x-12} ${y+14}q0-15 12-15t12 15`} stroke="#b9c9b2" /></g>)}
        <path d="M211 65H293L316 88V235H232L211 214Z" fill="#171e17" stroke="#ccff00" />
        <path d="M293 65V88H316M233 106H286M233 119H273M233 189H288M233 202H269" stroke="#81917b" />
        <text x="232" y="164" fill="#ebebeb" fontSize="25" fontFamily="monospace">5 SOL</text>
        <path d="M260 20V45M260 255V279" stroke="#ccff00" />
      </> : scene === "02" ? <>
        <path d="M260 32L363 75V157C363 213 301 254 260 274C219 254 157 213 157 157V75Z" stroke="#586461" strokeDasharray="3 7" />
        <path className={s.sceneConnection} d="M120 101L198 131M400 101L322 131M120 221L220 190M400 221L300 190" stroke="#a5b8af" strokeDasharray="5 6" />
        <path d="M251 70L200 92V154C200 185 225 208 251 223V161H226V134H251Z" fill="#1c2925" stroke="#b9cdc3" />
        <path d="M269 70L320 92V154C320 185 295 208 269 223V161H294V134H269Z" fill="#202b28" stroke="#b9cdc3" />
        <path d="M251 134H269V161H251Z" fill="#ccff00" />
        {[[120,101],[400,101],[120,221]].map(([x,y],i)=><g key={i}><path d={`M${x-23} ${y-23}h34l12 12v34h-46Z`} fill="#161e1c" stroke="#b9cdc3"/><path d={`M${x-8} ${y}h16M${x} ${y-8}v16`} stroke="#ccff00" /></g>)}
        <circle cx="400" cy="221" r="23" stroke="#64736d" strokeDasharray="3 5" />
      </> : <>
        <path d="M122 42H390L415 67V257H147L122 232Z" fill="#181c19" stroke="#9bad92" />
        <path d="M139 59H380L398 77V240H155L139 224Z" stroke="#465240" strokeDasharray="4 7" />
        <path d="M165 107H368M165 150H368M165 193H368M211 85V214M265 85V214M319 85V214" stroke="#2f382c" />
        <path className={s.sceneConnection} d="M54 150H182V107H238V193H298V150H364" stroke="#ccff00" strokeWidth="2" />
        {[[182,107],[238,107],[238,193],[298,193]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="5" fill="#1d251a" stroke="#ccff00" />)}
        <path d="M365 129V172M374 129V172" stroke="#ccff00" strokeWidth="3" />
        <path d="M415 150H471" stroke="#617057" strokeDasharray="4 7" />
        <rect x="34" y="130" width="40" height="40" rx="2" fill="#171d15" stroke="#9bad92" />
        <path d="M45 142L52 150L45 158M57 157H64" stroke="#ebebeb" />
        <text x="166" y="79" fill="#a5b89e" fontSize="10" fontFamily="monospace">PERMISSION BOUNDARY</text>
      </>}
    </svg>
    <span>{scene === "01" ? "MANY PERSPECTIVES. ONE DECISION DOCUMENT." : scene === "02" ? "PLAN THE PARTS. UNDERSTAND THE THRESHOLD." : "ACTIVITY INSIDE LIMITS. EXECUTION STILL GATED."}</span>
  </div>;
}
