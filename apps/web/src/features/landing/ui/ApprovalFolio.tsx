import { ArrowUpRight, Check, ShieldCheck, Users } from "lucide-react";
import s from "../routes/LandingPage.module.css";

/** A marketing illustration, never an actionable signing surface. */
export function ApprovalFolio() {
  return (
    <figure
      className={s.folio}
      aria-label="Illustration: a 5 SOL request, its policy and the people who approve it. Not a live transaction."
    >
      <div className={s.folioStage} aria-hidden="true">
        <div className={`${s.folioLayer} ${s.policyLayer}`}>
          <span className={s.layerLabel}>
            <ShieldCheck size={19} /> The rules
          </span>
          <strong>
            Boundaries.
            <br />
            Built in.
          </strong>
          <div className={s.layerLines}>
            <i />
            <i />
            <i />
          </div>
          <span className={s.layerFoot}>01 / YOUR POLICY</span>
        </div>
        <div className={`${s.folioLayer} ${s.peopleLayer}`}>
          <span className={s.layerLabel}>
            <Users size={19} /> Your people
          </span>
          <div className={s.layerPeople}>
            <i>S</i>
            <i>M</i>
            <i>A</i>
          </div>
          <strong>Shared control.</strong>
          <span className={s.layerFoot}>02 / YOUR OWNERS</span>
        </div>
        <div className={s.frontLayer}>
          <div className={s.folioCardTop}>
            <span className={s.folioGlyph}>
              <ArrowUpRight size={23} />
            </span>
            <span>
              TRANSFER REQUEST<small>Solana devnet · example</small>
            </span>
            <span className={s.folioSerial}>03</span>
          </div>
          <p className={s.folioAmount}>
            5 <span>SOL</span>
          </p>
          <div className={s.folioDestination}>
            <span>To</span>
            <strong>Operations vault</strong>
            <ArrowUpRight size={18} />
          </div>
          <div className={s.folioRule}>
            <ShieldCheck size={16} />
            <span>Within the 10 SOL limit</span>
            <Check size={16} />
          </div>
          <div className={s.folioApproval}>
            <div>
              <i>S</i>
              <i>M</i>
              <i>A</i>
            </div>
            <span>
              <strong>1 of 2 required approvals</strong>
              <small>3 members · 1 more needed</small>
            </span>
          </div>
          <div className={s.folioReceipt}>
            <span>READABLE BY DESIGN</span>
            <span>
              ClearSig <ArrowUpRight size={12} />
            </span>
          </div>
        </div>
      </div>
      <figcaption>
        Illustrative preview. No transaction or signature.
      </figcaption>
    </figure>
  );
}
