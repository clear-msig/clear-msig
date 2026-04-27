import clsx from "clsx";
import { motion } from "framer-motion";
import { useState, useRef } from "react";

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  variant?: "black" | "green";
};

export function CardShell({ title, subtitle, children, className, variant = "black" }: Props) {
  const isGreen = variant === "green";
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  return (
    <motion.section
      ref={cardRef}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={clsx(
        "rounded-[2.5rem] p-6 sm:p-8 shadow-card-shadow relative overflow-hidden transition-all duration-500 ease-out",
        isHovering ? "shadow-2xl sm:scale-[1.01]" : "",
        isGreen ? "bg-brand-green text-surface" : "bg-surface text-text-card",
        className
      )}
    >
      {/* Magnetic Glow Hover Effect */}
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
          opacity: isHovering && !isGreen ? 1 : 0,
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(20, 241, 149, 0.08), transparent 40%)`
        }}
      />
      <div 
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
          opacity: isHovering && isGreen ? 1 : 0,
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(255, 255, 255, 0.4), transparent 40%)`
        }}
      />

      <div 
        className={clsx(
          "absolute top-[-50%] right-[-10%] w-[60%] h-[150%] blur-[120px] pointer-events-none transition-all duration-700",
          isGreen ? "bg-white/20" : "bg-brand-green/10",
          isHovering ? "opacity-100 scale-110" : "opacity-60 scale-100"
        )} 
      />

      <header className="mb-6 flex flex-col gap-1.5 relative z-10">
        <h2 className={clsx(
          "text-2xl font-bold tracking-tight",
          isGreen ? "text-surface" : "text-brand-white"
        )}>{title}</h2>
        {subtitle ? 
          <p className={clsx(
            "text-sm font-medium",
            isGreen ? "text-surface/70" : "text-text-card-muted"
          )}>{subtitle}</p> 
        : null}
      </header>
      <div className="relative z-10">
        {children}
      </div>
    </motion.section>
  );
}
