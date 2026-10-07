import type { Icp, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { signalsSchema, type IcpInput, type Signals } from "@/lib/schemas";

export interface IcpDto extends Omit<Icp, "signals"> {
  signals: Signals;
}

function toDto(icp: Icp): IcpDto {
  return { ...icp, signals: signalsSchema.parse(icp.signals ?? {}) };
}

export async function listIcps(): Promise<IcpDto[]> {
  const rows = await prisma.icp.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(toDto);
}

export async function getIcp(id: string): Promise<IcpDto> {
  return toDto(await prisma.icp.findUniqueOrThrow({ where: { id } }));
}

export async function createIcp(input: IcpInput): Promise<IcpDto> {
  return toDto(await prisma.icp.create({ data: { ...input, signals: input.signals as Prisma.InputJsonValue } }));
}

export async function updateIcp(id: string, input: IcpInput): Promise<IcpDto> {
  return toDto(await prisma.icp.update({ where: { id }, data: { ...input, signals: input.signals as Prisma.InputJsonValue } }));
}

export async function deleteIcp(id: string): Promise<void> {
  await prisma.icp.delete({ where: { id } });
}
