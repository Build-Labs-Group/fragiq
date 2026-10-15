import { describe, expect, it } from "vitest";
import { lerPerfilGamersClub } from "@/lib/gamersclub";

describe("lerPerfilGamersClub", () => {
  it("aceita o número solto, sem zeros à esquerda", () => {
    expect(lerPerfilGamersClub("1879287")).toBe("1879287");
    expect(lerPerfilGamersClub("  001879287 ")).toBe("1879287");
  });

  it("aceita o link do perfil, com ou sem www, idioma, barra, query e âncora", () => {
    expect(lerPerfilGamersClub("https://gamersclub.com.br/player/1879287")).toBe("1879287");
    expect(lerPerfilGamersClub("http://www.gamersclub.com.br/player/1879287/")).toBe("1879287");
    expect(lerPerfilGamersClub("https://gamersclub.com.br/pt/player/1879287?x=1#top")).toBe("1879287");
  });

  it("recusa outro domínio, outro caminho, id não numérico e vazio", () => {
    for (const ruim of [
      "",
      "abc",
      "12a",
      "1234567890123",
      "https://evil.com/player/1879287",
      "https://gamersclub.com.br.evil.com/player/1879287",
      "https://gamersclub.com.br/lobby/1879287",
      "javascript:alert(1)",
      "-5",
    ]) {
      expect(lerPerfilGamersClub(ruim), ruim).toBeNull();
    }
  });
});
