import type { Env } from "../../../_lib/env";
import { handleReportRequest } from "../../../_lib/reports";

export { handleReportRequest };

export const onRequest: PagesFunction<Env> = async (context) =>
  handleReportRequest(context.request, context.env);

export const onRequestGet: PagesFunction<Env> = async (context) =>
  handleReportRequest(context.request, context.env);

export const onRequestHead: PagesFunction<Env> = async (context) =>
  handleReportRequest(context.request, context.env);
