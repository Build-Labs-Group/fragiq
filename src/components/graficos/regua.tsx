import type { Valencia } from "@/lib/delta";

/**
 * Régua (bullet chart): o valor como barra, a referência como um traço.
 *
 * É a resposta visual para "acima ou abaixo do meu normal?" sem ler dois
 * números e fazer a conta: a barra passa do traço ou não chega nele. A cor
 * da barra é a valência que o delta já calculou (`lib/delta.ts`) — verde
 * quando o movimento é bom para a estatística, vermelho quando é ruim,
 * neutra quando é ruído ou sem direção. Nunca o laranja da marca.
 *
 * Escala começa no zero (barra é magnitude), e o teto é o maior dos dois
 * com folga — ou 100 para porcentagem que cabe. Só desenho: os números
 * moram no texto ao lado, então a régua é `aria-hidden`.
 */
const COR: Record<Valencia | "nenhuma", string> = {
  good: "var(--good)",
  bad: "var(--bad)",
  neutral: "var(--ink-faint)",
  nenhuma: "var(--ink-faint)",
};

export function Regua({
  valor,
  referencia,
  valencia,
  emPct = false,
  className,
}: {
  valor: number | null;
  referencia: number | null;
  valencia: Valencia | null;
  emPct?: boolean;
  className?: string;
}) {
  if (valor === null || !Number.isFinite(valor)) return null;
  const maior = Math.max(valor, referencia ?? 0);
  const teto = emPct && maior <= 80 ? Math.min(100, Math.max(maior * 1.35, 10)) : emPct ? 100 : maior * 1.25 || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / teto) * 100))}%`;

  return (
    <div className={className} aria-hidden>
      <div className="relative h-2 w-full overflow-visible rounded-full bg-surface-2 ring-1 ring-line-soft">
        <div className="regua-barra absolute inset-y-0 left-0 rounded-full" style={{ width: pct(valor), background: COR[valencia ?? "nenhuma"] }} />
        {referencia !== null && Number.isFinite(referencia) && (
          <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: pct(referencia) }} />
        )}
      </div>
    </div>
  );
}
