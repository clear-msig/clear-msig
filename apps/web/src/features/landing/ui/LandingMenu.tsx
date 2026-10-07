"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { ClearCMark } from "@/components/landing/ClearCMark";
import chrome from "../routes/LandingPage.module.css";
import s from "./LandingMenu.module.css";

const groups = [
  { name: "Explore", links: [["The approval story", "#story-request"], ["Products", "#products"], ["Questions & resources", "#resources"]] },
  { name: "Products", links: [["Personal", "/personal"], ["Teams", "/pro"], ["Recovery · pre-alpha", "/secure"], ["Agents · execution gated", "/agent"]] },
  { name: "Understand", links: [["Security & limitations", "/security"], ["Privacy", "/privacy"], ["Changelog", "/changelog"]] },
];

export function LandingMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<string | null>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    const onBack = () => {
      if (history.state?.clearSigNavigation) {
        if (!dialog.current?.open) dialog.current?.showModal();
        setOpen(true);
        return;
      }
      if (!dialog.current?.open) return;
      dialog.current.close();
      setOpen(false);
      const next = pending.current;
      pending.current = null;
      // Finish this popstate before adding a destination; Next also restores
      // router state in this event and can otherwise overwrite a hash push.
      if (next) window.setTimeout(() => {
        if (next.startsWith("#")) location.hash = next;
        else router.push(next);
      }, 0);
      else trigger.current?.focus();
    };
    window.addEventListener("popstate", onBack);
    return () => { window.removeEventListener("popstate", onBack); };
  }, [router]);
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previous; };
  }, [open]);
  const show = () => {
    if (dialog.current?.open) return;
    history.pushState({ ...history.state, clearSigNavigation: true }, "", location.href);
    dialog.current?.showModal();
    setOpen(true);
  };
  const close = (destination?: string) => {
    pending.current = destination ?? null;
    if (history.state?.clearSigNavigation) history.back();
    else {
      dialog.current?.close();
      setOpen(false);
      if (destination) router.push(destination);
      else trigger.current?.focus();
    }
  };
  return <>
    <header className={chrome.header}>
      <Link href="/" className={chrome.brand} aria-label="ClearSig home"><ClearCMark size={30} alt="" variant="on-dark" />ClearSig</Link>
      <nav aria-label="Main navigation"><a href="#story-request">How it works</a><a href="#products">Products</a><Link href="/security">Security</Link></nav>
      <div className={s.actions}><button ref={trigger} type="button" className={s.menuButton} disabled={!ready} onClick={show} aria-haspopup="dialog" aria-controls="site-navigation" aria-expanded={open}><Menu size={16} aria-hidden="true" />Menu</button><Link className={chrome.headerAction} href="/connect">Sign in <ArrowRight size={15} aria-hidden="true" /></Link></div>
    </header>
    <dialog ref={dialog} id="site-navigation" className={s.dialog} aria-labelledby="navigation-title" onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)");
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(); } }}>
      <div className={s.top}><div><p>ClearSig / Navigation</p><h2 id="navigation-title">Find your next step.</h2></div><button autoFocus type="button" onClick={() => close()} aria-label="Close navigation"><X size={24} /></button></div>
      <nav className={s.groups} aria-label="All destinations">{groups.map(group => <section key={group.name}><h3>{group.name}</h3>{group.links.map(([label, href]) => <Link key={href} href={href} onClick={event => { event.preventDefault(); close(href); }}>{label}<ArrowRight size={14} aria-hidden="true" /></Link>)}</section>)}</nav>
      <div className={s.bottom}><span>Devnet preview. Test funds only.</span><Link href="/choose" onClick={event => { event.preventDefault(); close("/choose"); }}>Choose a product <ArrowRight size={16} aria-hidden="true" /></Link></div>
    </dialog>
  </>;
}
