/**
 * Rótulos de mapa e modo do CS2.
 *
 * Fora de qualquer componente porque as duas pontas precisam deles: a barra
 * de filtro e o seletor de sincronização são client components, a lista de
 * partidas é server component, e função exportada de um módulo "use client"
 * não pode ser chamada no servidor.
 */

const MODOS: Record<string, string> = {
  competitive: "Competitivo",
  casual: "Casual",
  deathmatch: "Deathmatch",
  premier: "Premier",
  scrimcomp2v2: "Wingman",
  retakes: "Retakes",
  survival: "Danger Zone",
  gungameprogressive: "Arms Race",
  gungametrbomb: "Demolição",
  training: "Treino",
  /** O GSI publica o competitivo com outro nome em algumas versões. */
  competitive2v2: "Wingman",
};

export function rotularModo(modo: string) {
  return MODOS[modo] ?? modo;
}

/**
 * de_anubis → Anubis, cs_office → Office.
 *
 * O prefixo é o tipo de mapa (de_ desarme, cs_ reféns, ar_ arms race) e não
 * diz nada a quem joga: ninguém chama Mirage de "de_mirage" em voz alta.
 * Mapas de workshop e nomes fora do padrão passam inteiros.
 */
export function rotularMapa(mapa: string) {
  const semPrefixo = mapa.replace(/^(de|cs|ar|dz|gd|coop)_/, "");
  return semPrefixo.charAt(0).toUpperCase() + semPrefixo.slice(1);
}

const ARMAS: Record<string, string> = {
  ak47: "AK-47",
  m4a1: "M4A1",
  awp: "AWP",
  deagle: "Desert Eagle",
  glock: "Glock",
  hkp2000: "USP-S / P2000",
  p250: "P250",
  fiveseven: "Five-SeveN",
  tec9: "Tec-9",
  elite: "Dual Berettas",
  galilar: "Galil AR",
  famas: "FAMAS",
  aug: "AUG",
  sg556: "SG 553",
  ssg08: "SSG 08",
  scar20: "SCAR-20",
  g3sg1: "G3SG1",
  mac10: "MAC-10",
  mp7: "MP7",
  mp9: "MP9",
  ump45: "UMP-45",
  p90: "P90",
  bizon: "PP-Bizon",
  nova: "Nova",
  xm1014: "XM1014",
  mag7: "MAG-7",
  sawedoff: "Sawed-Off",
  m249: "M249",
  negev: "Negev",
  taser: "Zeus",
  hegrenade: "Granada HE",
  molotov: "Molotov",
  knife: "Faca",
};

export function rotularArma(arma: string) {
  return ARMAS[arma] ?? arma.toUpperCase();
}

/**
 * Como uma arma aparece escrita por gente (ou por um modelo): "USP-S",
 * "Galil", "M4". Só para achar a arma num texto livre — o rótulo de um
 * achado do analista, a causa que ele escreveu. Sem acento, minúsculo,
 * pontuação virando espaço (`normalizarTexto`).
 */
const ALIASES_DE_ARMA: Record<string, string[]> = {
  ak47: ["ak 47", "ak47", "ak"],
  m4a1: ["m4a1", "m4a1 s", "m4a4", "m4"],
  awp: ["awp"],
  deagle: ["desert eagle", "deagle"],
  glock: ["glock 18", "glock"],
  hkp2000: ["usp s", "usp", "p2000", "hkp2000"],
  p250: ["p250"],
  fiveseven: ["five seven", "fiveseven"],
  tec9: ["tec 9", "tec9"],
  elite: ["dual berettas", "berettas"],
  galilar: ["galil ar", "galil"],
  famas: ["famas"],
  aug: ["aug"],
  sg556: ["sg 553", "sg553", "sg 556", "sg556", "krieg"],
  ssg08: ["ssg 08", "ssg08", "scout"],
  scar20: ["scar 20", "scar20"],
  g3sg1: ["g3sg1"],
  mac10: ["mac 10", "mac10"],
  mp7: ["mp7"],
  mp9: ["mp9"],
  ump45: ["ump 45", "ump45", "ump"],
  p90: ["p90"],
  bizon: ["pp bizon", "bizon"],
  nova: ["nova"],
  xm1014: ["xm1014"],
  mag7: ["mag 7", "mag7"],
  sawedoff: ["sawed off", "sawedoff"],
  m249: ["m249"],
  negev: ["negev"],
  taser: ["zeus", "taser"],
};

/** Minúsculo, sem acento, com pontuação virando espaço: "USP-S / P2000" → "usp s p2000". */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * As armas citadas num texto livre, na ordem em que aparecem.
 *
 * "Nova" é arma e é adjetivo ("na nova sessão"): só conta como arma quando
 * não vem antes de sessão, partida, rodada, semana ou noite.
 */
export function armasNoTexto(texto: string): string[] {
  const t = ` ${normalizarTexto(texto)} `;
  const achadas: { arma: string; pos: number }[] = [];
  for (const [arma, aliases] of Object.entries(ALIASES_DE_ARMA)) {
    for (const alias of aliases) {
      const re = new RegExp(` ${alias} `, "g");
      let m: RegExpExecArray | null;
      let pos = -1;
      while ((m = re.exec(t))) {
        if (arma === "nova" && /^ nova (sessao|partida|rodada|semana|noite|fase|chance|tentativa)/.test(t.slice(m.index))) {
          re.lastIndex = m.index + 1;
          continue;
        }
        pos = m.index;
        break;
      }
      if (pos >= 0) {
        achadas.push({ arma, pos });
        break;
      }
    }
  }
  return achadas.sort((a, b) => a.pos - b.pos).map((a) => a.arma);
}

/** Rótulos de modo que um texto pode citar ("no Competitivo"). */
export function modosNoTexto(texto: string): string[] {
  const t = ` ${normalizarTexto(texto)} `;
  const vistos = new Set<string>();
  for (const [id, rotulo] of Object.entries(MODOS)) {
    if (t.includes(` ${normalizarTexto(rotulo)} `)) vistos.add(id === "competitive2v2" ? "scrimcomp2v2" : id);
  }
  return [...vistos];
}

/**
 * O nome em português de um contador cru da Steam, para listas e cartões.
 *
 * `humanizeKey` (series.ts) é genérico de propósito — serve a qualquer
 * jogo — e devolvia "Kills · ak47" e "Damage done". Aqui ficam os nomes do
 * CS2; chave que não está aqui cai no genérico.
 */
const METRICAS: Record<string, string> = {
  total_kills: "Kills",
  total_deaths: "Mortes",
  total_kills_headshot: "Headshots",
  total_damage_done: "Dano causado",
  total_mvps: "MVPs",
  total_wins: "Rounds ganhos",
  total_wins_pistolround: "Pistolas ganhos",
  total_matches_played: "Partidas",
  total_matches_won: "Partidas ganhas",
  total_rounds_played: "Rounds jogados",
  total_time_played: "Tempo em partida",
  total_planted_bombs: "Bombas plantadas",
  total_defused_bombs: "Bombas desarmadas",
  total_rescued_hostages: "Reféns resgatados",
  total_kills_enemy_blinded: "Kills em inimigo cego",
  total_kills_enemy_weapon: "Kills com arma do inimigo",
  total_kills_against_zoomed_sniper: "Kills em sniper com mira",
  total_kills_knife_fight: "Kills em duelo de faca",
  total_dominations: "Dominações",
  total_domination_overkills: "Kills em quem já dominava",
  total_revenges: "Vinganças",
  total_contribution_score: "Pontos de contribuição",
  total_money_earned: "Dinheiro ganho",
  total_weapons_donated: "Armas doadas",
  total_broken_windows: "Janelas quebradas",
  total_shots_fired: "Tiros disparados",
  total_shots_hit: "Acertos (contador quebrado da Valve)",
  total_gg_matches_played: "Partidas de Arms Race",
  total_gg_matches_won: "Vitórias em Arms Race",
  total_progressive_matches_won: "Vitórias em Arms Race progressivo",
  total_trbomb_matches_won: "Vitórias em Demolição",
  total_gun_game_rounds_played: "Rounds de Arms Race",
  total_gun_game_rounds_won: "Rounds ganhos em Arms Race",
  total_gun_game_contribution_score: "Pontos em Arms Race",
};

export function rotularMetrica(chave: string, generico: (chave: string) => string): string {
  if (chave in METRICAS) return METRICAS[chave];
  const arma = /^total_(kills|shots|hits)_([a-z0-9]+)$/.exec(chave);
  if (arma) return `${{ kills: "Kills", shots: "Tiros", hits: "Acertos" }[arma[1] as "kills" | "shots" | "hits"]} · ${rotularArma(arma[2])}`;
  const mapa = /^total_(rounds|wins)_map_(.+)$/.exec(chave);
  if (mapa) return `${mapa[1] === "rounds" ? "Rounds" : "Rounds ganhos"} · ${rotularMapa(mapa[2])}`;
  const ganhas = /^total_matches_won_(.+)$/.exec(chave);
  if (ganhas) return `Partidas ganhas · ${rotularMapa(ganhas[1])}`;
  return generico(chave);
}

/**
 * Quais armas aparecem num conjunto de contadores da Steam.
 *
 * Uma arma é o que tem `total_shots_<arma>` — `total_shots_fired` e
 * `total_shots_hit` são globais, e o segundo ainda está quebrado na Valve
 * (README, "Uma armadilha da Valve"). Faca e granada matam sem disparar,
 * então ficam de fora por construção: sem par tiros/acertos não há
 * precisão para comparar.
 */
export function armasNasMetricas(metrics: Record<string, number>): string[] {
  return Object.keys(metrics)
    .filter((k) => k.startsWith("total_shots_") && k !== "total_shots_fired" && k !== "total_shots_hit")
    .map((k) => k.replace("total_shots_", ""));
}
