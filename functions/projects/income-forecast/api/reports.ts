import type { Env } from "../../../_lib/env";
import {
  handleReportListRequest,
  type ReportDependencies,
} from "../../../_lib/reports";

export { handleReportListRequest };
export type { ReportDependencies };

export const handleReportsRequest = handleReportListRequest;

export const onRequestGet: PagesFunction<Env> = async (context) =>
  handleReportListRequest(context.request, context.env);

export const onRequest: PagesFunction<Env> = async (context) =>
  handleReportListRequest(context.request, context.env);
