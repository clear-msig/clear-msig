import s from "../routes/LandingPage.module.css";

/** Static, decorative geometry. The adjacent caption conveys the example. */
export function QuorumScene() {
  return (
    <figure className={s.quorumScene}>
      <svg
        viewBox="0 0 760 440"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="vault-face"
            x1="280"
            y1="130"
            x2="470"
            y2="360"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#353539" />
            <stop offset="1" stopColor="#101012" />
          </linearGradient>
          <linearGradient
            id="vault-top"
            x1="300"
            y1="90"
            x2="460"
            y2="240"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#606065" />
            <stop offset="1" stopColor="#18181d" />
          </linearGradient>
        </defs>
        <g stroke="#333336">
          <path d="M40 220H720M380 30V410" strokeDasharray="3 9" />
          <ellipse cx="380" cy="237" rx="325" ry="132" />
          <ellipse cx="380" cy="237" rx="273" ry="107" strokeDasharray="2 7" />
          <path d="M85 330 380 160 675 330M85 145 380 315 675 145" />
        </g>
        <g stroke="#77777c" strokeWidth="1.5" strokeLinejoin="round">
          <path
            d="m380 88 120 69v142l-120 70-120-70V157Z"
            fill="url(#vault-face)"
          />
          <path d="m260 157 120 70 120-70-120-69Z" fill="url(#vault-top)" />
          <path d="M380 227v142" />
          <path d="m274 179 91 53v111l-91-53Z" stroke="#45454b" />
          <path d="m395 235 90-52v107l-90 53Z" stroke="#45454b" />
        </g>
        <g stroke="#ccff00" strokeWidth="2">
          <path d="m324 154 56-32 56 32-56 32Z" fill="#ccff0010" />
          <path d="m355 154 18 10 33-19" strokeWidth="4" />
          <path d="M260 226 168 279H93" />
          <circle cx="92" cy="279" r="20" fill="#0c0c0c" />
          <path d="m84 279 6 6 11-12" strokeWidth="3" />
        </g>
        <g stroke="#a3a3a3" strokeWidth="1.5">
          <path d="m500 226 89 51h78M380 88V57h165" strokeDasharray="5 5" />
          <path d="m668 257 22 21-22 22-22-22Z" fill="#131316" />
          <path d="m557 42 15 15-15 15-15-15Z" fill="#131316" />
        </g>
        <g
          fill="#a3a3a3"
          fontFamily="monospace"
          fontSize="12"
          letterSpacing="1"
        >
          <text x="56" y="321">
            01 / APPROVED
          </text>
          <text x="550" y="321">
            02 / PENDING
          </text>
          <text x="583" y="61">
            03 / PENDING
          </text>
          <text x="322" y="406">
            SHARED CONTROL
          </text>
        </g>
      </svg>
      <figcaption>
        <span>QUORUM / 01 OF 02 REQUIRED</span>
        <span>Illustrative preview. No transaction or signature.</span>
      </figcaption>
    </figure>
  );
}
