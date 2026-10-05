"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Número que conta de zero até o valor quando entra na tela.
 *
 * O HTML do servidor já sai com o valor final: sem JavaScript, para leitor
 * de tela e para quem compartilha o link, o número é o certo (antes era 0).
 * A contagem só roda se o número ainda está fora da tela ao montar.
 */
export function Contador({ ate, sufixo = "", className }: { ate: number; sufixo?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [valor, setValor] = useState(ate);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValor(ate);
      return;
    }
    const caixa = el.getBoundingClientRect();
    if (caixa.top < window.innerHeight && caixa.bottom > 0) return;
    setValor(0);
    const obs = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      const inicio = performance.now();
      const dur = 1100;
      const tick = (t: number) => {
        const p = Math.min(1, (t - inicio) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setValor(Math.round(ate * eased));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ate]);

  return (
    <span ref={ref} className={className}>
      {valor.toLocaleString("pt-BR")}
      {sufixo}
    </span>
  );
}
