import s from "../routes/LandingPage.module.css";

/** Original decorative diagrams. Product readiness is stated in adjacent copy. */
export function ProductScene({ scene }: { scene: string }) {
  return <div className={s.productScene} data-scene={scene} aria-hidden="true">
    <svg viewBox="0 0 520 300" fill="none" focusable="false">
      <ellipse cx="260" cy="150" rx="222" ry="118" stroke="#333336" strokeDasharray="3 9" />
      <ellipse cx="260" cy="150" rx="162" ry="82" stroke="#333336" />
      {scene === "01" ? <>
        <path d="M104 91L260 150L416 91M104 209L260 150L416 209" stroke="#a5b89e" />
        {[ [104,91], [416,91], [104,209], [416,209] ].map(([x,y]) => <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="25" fill="#131316" stroke="#a5b89e" />
          <circle cx={x} cy={y-5} r="6" stroke="#a5b89e" />
          <path d={`M${x-11} ${y+12}q0-13 11-13t11 13`} stroke="#a5b89e" />
        </g>)}
        <path d="M213 98H297L313 114V202H229L213 186Z" fill="#19191d" stroke="#ccff00" />
        <path d="M234 126H286M234 141H274M234 171H260" stroke="#ebebeb" strokeWidth="2" />
        <circle cx="286" cy="175" r="6" fill="#ccff00" />
      </> : scene === "02" ? <>
        <path d="M132 95L260 150L388 95M132 205L260 150L388 205" stroke="#a5b89e" strokeDasharray="5 6" />
        <path d="M260 78L322 102V151C322 190 286 217 260 229C234 217 198 190 198 151V102Z" fill="#19191d" stroke="#a5b89e" />
        <path d="M260 94V214" stroke="#505054" strokeDasharray="3 6" />
        <circle cx="260" cy="142" r="17" fill="#131316" stroke="#ccff00" />
        <path d="M260 160V185M260 177H273" stroke="#ccff00" strokeWidth="3" />
        {[ [132,95], [388,95], [132,205] ].map(([x,y]) => <g key={`${x}-${y}`}><rect x={x-20} y={y-20} width="40" height="40" rx="5" fill="#131316" stroke="#a5b89e" /><path d={`M${x-7} ${y}h14M${x} ${y-7}v14`} stroke="#a5b89e" /></g>)}
        <circle cx="388" cy="205" r="20" fill="#131316" stroke="#505054" strokeDasharray="3 4" />
      </> : <>
        <rect x="169" y="62" width="216" height="176" rx="14" fill="#131316" stroke="#a5b89e" />
        <rect x="185" y="78" width="184" height="144" rx="8" stroke="#333336" strokeDasharray="4 5" />
        <path d="M72 150H228M302 150H440" stroke="#a5b89e" />
        <path d="M220 143L228 150L220 157M432 143L440 150L432 157" stroke="#a5b89e" />
        <rect x="55" y="126" width="48" height="48" rx="8" fill="#19191d" stroke="#a5b89e" />
        <path d="M70 143L77 150L70 157M83 157H91" stroke="#ebebeb" />
        <path d="M247 114H287L303 130V186H247Z" fill="#19191d" stroke="#ccff00" />
        <path d="M260 138H288M260 150H281M260 162H288" stroke="#ebebeb" />
        <path d="M440 132V168M450 132V168" stroke="#ccff00" strokeWidth="3" />
      </>}
    </svg>
    <span>{scene === "01" ? "ONE REQUEST · SHARED CONTEXT" : scene === "02" ? "A SEPARATE PATH TO PLAN" : "AUTHORITY HAS A BOUNDARY"}</span>
  </div>;
}
