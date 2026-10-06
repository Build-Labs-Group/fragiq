import { CS2_PANEL } from "./cs2-panel";

/**
 * Para que lado é melhor, por métrica: uma tabela só, no código.
 *
 * A seta e a cor de um chip dependem de saber se subir é bom. Até 05/10/2026
 * a tabela de métricas pintava tudo de cinza (não sabia) e os achados do
 * analista usavam o `melhorQuando` que o modelo escrevia — e o modelo
 * escreveu "Dano por round: melhor quando desce" em produção. Agora a
 * direção é dado do produto, não opinião do modelo: as estatísticas do
 * painel declaram a sua (`cs2-panel.ts`), e os contadores crus da Steam
 * estão aqui. O que não está na tabela é "nenhuma" — chip cinza, sem
 * valência —, que é o honesto quando não se sabe.
 */
export type Direcao = "sobe" | "desce" | "nenhuma";

/** Contadores crus da Steam lidos como taxa por round. */
const POR_CHAVE: Record<string, Direcao> = {
  total_kills: "sobe",
  total_deaths: "desce",
  total_kills_headshot: "sobe",
  total_damage_done: "sobe",
  total_mvps: "sobe",
  total_wins: "sobe",
  total_wins_pistolround: "sobe",
  total_matches_won: "sobe",
  total_planted_bombs: "sobe",
  total_defused_bombs: "sobe",
  total_rescued_hostages: "sobe",
  total_kills_enemy_blinded: "sobe",
  total_kills_enemy_weapon: "sobe",
  total_kills_against_zoomed_sniper: "sobe",
  total_kills_knife_fight: "sobe",
  total_dominations: "sobe",
  total_domination_overkills: "sobe",
  total_revenges: "sobe",
  total_contribution_score: "sobe",
  total_money_earned: "sobe",
  total_gun_game_rounds_won: "sobe",
  total_gg_matches_won: "sobe",
  total_progressive_matches_won: "sobe",
  total_trbomb_matches_won: "sobe",
  // Volume: quanto se jogou, atirou ou doou não é bom nem ruim.
  total_rounds_played: "nenhuma",
  total_matches_played: "nenhuma",
  total_time_played: "nenhuma",
  total_shots_fired: "nenhuma",
  total_shots_hit: "nenhuma",
  total_weapons_donated: "nenhuma",
  total_broken_windows: "nenhuma",
  total_gg_matches_played: "nenhuma",
  total_gun_game_rounds_played: "nenhuma",
  total_gun_game_contribution_score: "nenhuma",
};

const PADROES: [RegExp, Direcao][] = [
  [/^last_match_/, "nenhuma"],
  [/^total_shots_/, "nenhuma"],
  [/^total_rounds_map_/, "nenhuma"],
  [/^total_kills_[a-z0-9]+$/, "sobe"],
  [/^total_hits_[a-z0-9]+$/, "sobe"],
  [/^total_wins_map_/, "sobe"],
  [/^total_matches_won_/, "sobe"],
];

/** A direção de um contador cru da Steam (`total_kills_ak47`, `total_deaths`…). */
export function direcaoDoContador(chave: string): Direcao {
  if (chave in POR_CHAVE) return POR_CHAVE[chave];
  for (const [padrao, direcao] of PADROES) if (padrao.test(chave)) return direcao;
  return "nenhuma";
}

/** A direção de uma estatística do painel (`kd`, `adr`, `rounds`…); desconhecida é "nenhuma". */
export function direcaoDoPainel(chave: string): Direcao {
  return CS2_PANEL.find((s) => s.key === chave)?.melhorQuando ?? "nenhuma";
}
