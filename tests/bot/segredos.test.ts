import { describe, expect, it } from "vitest";
import { criarArmazem, gravarRefreshToken, type Cliente } from "../../bot/src/segredos";

/**
 * Comando como o SDK monta: o nome da classe e o input. O SDK vem do
 * node_modules do bot, então o teste compara pelo nome, não por instanceof.
 */
type Comando = { nome: string; input: Record<string, unknown> };
const comando = (c: unknown): Comando => ({ nome: (c as object).constructor.name, input: (c as { input: Record<string, unknown> }).input });

/** Cliente falso da AWS: guarda os comandos e responde pelo tipo. */
function falso(responder: (comando: Comando) => unknown) {
  const enviados: Comando[] = [];
  const cliente: Cliente = {
    async send(c) {
      enviados.push(comando(c));
      return responder(comando(c));
    },
  };
  return { cliente, enviados };
}

const guardado = { STEAM_BOT_REFRESH_TOKEN: "velho", FRAGIQ_WEBHOOK_SECRET: "s", STEAM_BOT_ACCOUNT: "conta" };

describe("segredos do bot", () => {
  it("FRAGIQ_SECRET_PARAM: lê o SecureString decifrado do Parameter Store", async () => {
    const ssm = falso(() => ({ Parameter: { Value: JSON.stringify(guardado) } }));
    const armazem = criarArmazem({ FRAGIQ_SECRET_PARAM: " /fragiq/prod/bot " }, { ssm: ssm.cliente });

    expect(armazem?.nome).toBe("ssm:/fragiq/prod/bot");
    expect(await armazem!.ler()).toEqual(guardado);
    expect(ssm.enviados[0]?.nome).toBe("GetParameterCommand");
    expect(ssm.enviados[0]?.input).toEqual({ Name: "/fragiq/prod/bot", WithDecryption: true });
  });

  it("refresh token renovado: regrava no parâmetro sem perder as outras chaves", async () => {
    const ssm = falso((c) => (c.nome === "GetParameterCommand" ? { Parameter: { Value: JSON.stringify(guardado) } } : {}));
    const armazem = criarArmazem({ FRAGIQ_SECRET_PARAM: "/fragiq/prod/bot" }, { ssm: ssm.cliente });

    await gravarRefreshToken("novo", armazem);

    const put = ssm.enviados.find((c) => c.nome === "PutParameterCommand")!;
    expect(put.input).toMatchObject({ Name: "/fragiq/prod/bot", Type: "SecureString", Overwrite: true });
    expect(JSON.parse(put.input.Value as string)).toEqual({ ...guardado, STEAM_BOT_REFRESH_TOKEN: "novo" });
  });

  it("parâmetro tem precedência sobre o Secrets Manager (os dois definidos na migração)", async () => {
    const ssm = falso(() => ({ Parameter: { Value: "{}" } }));
    const sm = falso(() => {
      throw new Error("não deveria chamar o Secrets Manager");
    });
    const armazem = criarArmazem(
      { FRAGIQ_SECRET_PARAM: "/fragiq/prod/bot", FRAGIQ_SECRET_ID: "fragiq/bot" },
      { ssm: ssm.cliente, secretsManager: sm.cliente },
    );
    await armazem!.ler();
    expect(armazem?.nome).toBe("ssm:/fragiq/prod/bot");
    expect(sm.enviados).toHaveLength(0);
  });

  it("FRAGIQ_SECRET_ID (volta para a conta antiga): Secrets Manager continua lendo e gravando", async () => {
    const sm = falso((c) => (c.nome === "GetSecretValueCommand" ? { SecretString: JSON.stringify(guardado) } : {}));
    const armazem = criarArmazem({ FRAGIQ_SECRET_ID: "fragiq/bot" }, { secretsManager: sm.cliente });

    expect(armazem?.nome).toBe("secretsmanager:fragiq/bot");
    await gravarRefreshToken("novo", armazem);
    const put = sm.enviados.find((c) => c.nome === "PutSecretValueCommand")!;
    expect(put.input.SecretId).toBe("fragiq/bot");
    expect(JSON.parse(put.input.SecretString as string)).toEqual({ ...guardado, STEAM_BOT_REFRESH_TOKEN: "novo" });
  });

  it("sem nenhuma das duas: caminho do .env, e gravar falha com motivo", async () => {
    expect(criarArmazem({ FRAGIQ_SECRET_PARAM: "  ", FRAGIQ_SECRET_ID: "" })).toBeNull();
    await expect(gravarRefreshToken("novo", null)).rejects.toThrow(/FRAGIQ_SECRET_PARAM/);
  });
});
