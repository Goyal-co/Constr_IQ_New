import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import type { CanvasElement, Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  ACTIVITY_STATUS_LABELS,
  MATERIAL_STATUS_LABELS,
  PROCUREMENT_STATE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  formatDate,
  parseIsoDate,
  type PortfolioReport,
  type ProjectDetail,
  type ReportQueryDto,
} from '@ciq/shared';
import { ProjectsService } from '../projects/projects.service';
import { ReportsService } from '../reports/reports.service';
import { SettingsService } from '../organisation/settings.service';
import { brandAsset } from './brand-asset';

/**
 * Standard PDF fonts.
 *
 * pdfmake needs font files or the built-in Roboto set. Using the built-ins keeps
 * the container image small and avoids shipping font binaries; the trade-off is
 * that non-Latin scripts will not render, which is documented in the export UI.
 */
const PDF_FONTS = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

/**
 * Logo widths in PDF points.
 *
 * Width only — pdfmake derives the height from the image's own proportions, so
 * a replacement asset with a different ratio still lands undistorted. 132pt in
 * the running header leaves the page number clear on A4 landscape; the top
 * margin is 64pt, which fits the ~33pt tall mark plus its 18pt offset.
 */
const HEADER_LOGO_WIDTH = 132;
const COVER_LOGO_WIDTH = 208;

/**
 * Status series colours, matching the screen.
 *
 * The light-mode steps from `tokens.css`, hard-coded because a PDF cannot read a
 * CSS custom property. They must stay in step with that file: a status printed
 * in a different colour than the screen showed it is worse than no colour.
 * Order is fixed — Discussion, In Progress, On Hold, Completed.
 */
const CHART_SERIES: Record<string, string> = {
  DISCUSSION: '#3b6fe0',
  IN_PROGRESS: '#d99a1f',
  ON_HOLD: '#b03060',
  COMPLETED: '#0f9d8f',
};

const CHART_DESIGN = '#3b6fe0';
const CHART_EXECUTION = '#0f9d8f';

/** Plot width in points. A4 landscape less the 32pt margins. */
const BAR_WIDTH = 745;
const BAR_HEIGHT = 16;

/** Surface-coloured gap between adjacent fills, in points. */
const GAP = 2;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

export interface ExportFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Server-rendered exports.
 *
 * The browser print view is fine for a quick copy, but a management pack needs
 * consistent pagination, a header on every page and numbers that match the API
 * exactly. Both formats are generated from the same `PortfolioReport` the screen
 * renders, so an exported figure can never disagree with the one on screen.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly reports: ReportsService,
    private readonly projects: ProjectsService,
    private readonly settings: SettingsService,
  ) {}

  // -------------------------------------------------------------------------
  // Excel
  // -------------------------------------------------------------------------

  async portfolioWorkbook(organisationId: string, query: ReportQueryDto): Promise<ExportFile> {
    const report = await this.reports.build(organisationId, query);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ConstructIQ Tracker';
    workbook.created = new Date();

    this.addCoverSheet(workbook, report.title, [
      ['Prepared for management', formatDate(new Date())],
      ['Projects', report.kpis.totalProjects],
      ['Active', report.kpis.activeProjects],
      ['Design complete', `${report.kpis.designPct}%`],
      ['Execution complete', `${report.kpis.executionPct}%`],
      ['Orders overdue', report.kpis.ordersOverdue],
      ['At risk', report.kpis.projectsAtRisk],
    ]);
    this.addSummarySheet(workbook, report);
    this.addStatusSheet(workbook, report);
    this.addProcurementSheet(workbook, report);
    this.addCategorySheet(workbook, report);
    this.addPhaseSheet(workbook, report);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `portfolio-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private addSummarySheet(workbook: ExcelJS.Workbook, report: PortfolioReport): void {
    const sheet = workbook.addWorksheet('Summary');
    sheet.columns = [
      { header: 'Measure', key: 'measure', width: 34 },
      { header: 'Value', key: 'value', width: 18 },
    ];
    this.styleHeader(sheet);

    const k = report.kpis;
    const rows: [string, string | number][] = [
      ['Total projects', k.totalProjects],
      ['Active', k.activeProjects],
      ['Completed', k.completedProjects],
      ...PROJECT_STATUSES.map(
        (status) => [PROJECT_STATUS_LABELS[status], k.byStatus[status]] as [string, number],
      ),
      ['Drawings complete', `${k.designComplete} of ${k.designTotal}`],
      ['Design %', `${k.designPct}%`],
      ['Execution %', `${k.executionPct}%`],
      ['Activities behind plan', k.executionDelayed],
      ['Materials tracked', k.materialsTotal],
      ['Orders overdue', k.ordersOverdue],
      ['Orders due soon', k.ordersDueSoon],
      ['Projects at risk', k.projectsAtRisk],
    ];
    rows.forEach(([measure, value]) => sheet.addRow({ measure, value }));

    sheet.addRow([]);
    const summaryRow = sheet.addRow(['Executive summary', report.executiveSummary]);
    summaryRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    if (report.commentary) {
      const commentaryRow = sheet.addRow(['Management commentary', report.commentary]);
      commentaryRow.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    }
  }

  private addStatusSheet(workbook: ExcelJS.Workbook, report: PortfolioReport): void {
    const sheet = workbook.addWorksheet('Project status');
    sheet.columns = [
      { header: 'Project', key: 'name', width: 32 },
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Consultant', key: 'consultant', width: 20 },
      { header: 'Manager', key: 'manager', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Handover', key: 'handover', width: 14 },
      { header: 'Days to handover', key: 'days', width: 16 },
      { header: 'Design %', key: 'drawings', width: 12 },
      { header: 'Execution %', key: 'execution', width: 12 },
      { header: 'Orders overdue', key: 'overdue', width: 14 },
      { header: 'Items late', key: 'late', width: 12 },
      { header: 'Blocked', key: 'blocked', width: 10 },
      { header: 'Flag', key: 'flag', width: 12 },
      { header: 'Risk reasons', key: 'reasons', width: 60 },
    ];
    this.styleHeader(sheet);

    for (const project of report.statusSheet) {
      const m = project.metrics;
      const row = sheet.addRow({
        name: project.name,
        code: project.code ?? '',
        category: project.category.name,
        consultant: project.consultant ?? '',
        manager: project.manager?.name ?? '',
        status: PROJECT_STATUS_LABELS[project.status],
        handover: project.handoverDate ? parseIsoDate(project.handoverDate) : '',
        days: m.daysToHandover ?? '',
        drawings: m.designPct / 100,
        execution: m.executionPct / 100,
        overdue: m.materialsOverdue,
        late: m.executionDelayed,
        blocked: m.executionBlocked,
        flag: project.status === 'COMPLETED' ? 'Done' : m.atRisk ? 'At risk' : 'On track',
        reasons: m.riskReasons.join('; '),
      });

      row.getCell('handover').numFmt = 'dd mmm yyyy';
      row.getCell('drawings').numFmt = '0%';
      row.getCell('execution').numFmt = '0%';
      if (m.atRisk && project.status !== 'COMPLETED') {
        row.getCell('flag').font = { color: { argb: 'FFC2544D' }, bold: true };
      }
    }

    sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private addProcurementSheet(workbook: ExcelJS.Workbook, report: PortfolioReport): void {
    const sheet = workbook.addWorksheet('Procurement');
    sheet.columns = [
      { header: 'Order by', key: 'orderBy', width: 14 },
      { header: 'Days', key: 'days', width: 8 },
      { header: 'State', key: 'state', width: 12 },
      { header: 'Material', key: 'material', width: 30 },
      { header: 'Project', key: 'project', width: 30 },
      { header: 'Phase', key: 'phase', width: 18 },
      { header: 'Lead time (weeks)', key: 'lead', width: 16 },
      { header: 'Blocks', key: 'blocks', width: 30 },
      { header: 'Supplier', key: 'supplier', width: 24 },
    ];
    this.styleHeader(sheet);

    for (const alert of report.procurementAlerts) {
      const row = sheet.addRow({
        orderBy: parseIsoDate(alert.orderByDate),
        days: alert.daysUntilOrderBy,
        state: PROCUREMENT_STATE_LABELS[alert.procurementState],
        material: alert.materialName,
        project: alert.projectName,
        phase: alert.phaseName,
        lead: alert.leadTimeWeeks ?? '',
        blocks: alert.blocksWorkItemName ?? '',
        supplier: alert.supplier ?? '',
      });
      row.getCell('orderBy').numFmt = 'dd mmm yyyy';
      if (alert.procurementState === 'OVERDUE') {
        row.getCell('state').font = { color: { argb: 'FFC2544D' }, bold: true };
      }
    }

    if (report.procurementAlerts.length === 0) {
      sheet.addRow({ orderBy: '', state: 'No orders currently need action' });
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private addCategorySheet(workbook: ExcelJS.Workbook, report: PortfolioReport): void {
    const sheet = workbook.addWorksheet('By category');
    sheet.columns = [
      { header: 'Category', key: 'category', width: 28 },
      { header: 'Total', key: 'total', width: 10 },
      ...PROJECT_STATUSES.map((status) => ({
        header: PROJECT_STATUS_LABELS[status],
        key: status,
        width: 14,
      })),
    ];
    this.styleHeader(sheet);

    for (const row of report.byCategory) {
      sheet.addRow({
        category: row.categoryName,
        total: row.total,
        ...Object.fromEntries(PROJECT_STATUSES.map((s) => [s, row.counts[s]])),
      });
    }
  }

  private addPhaseSheet(workbook: ExcelJS.Workbook, report: PortfolioReport): void {
    const sheet = workbook.addWorksheet('By phase');
    sheet.columns = [
      { header: 'Phase', key: 'phase', width: 26 },
      { header: 'Projects', key: 'projects', width: 12 },
      { header: 'Design %', key: 'drawings', width: 14 },
      { header: 'Execution %', key: 'execution', width: 14 },
      { header: 'Materials outstanding', key: 'materials', width: 22 },
    ];
    this.styleHeader(sheet);

    for (const row of report.byPhase) {
      const added = sheet.addRow({
        phase: row.phase.name,
        projects: row.projectCount,
        drawings: row.designPct / 100,
        execution: row.executionPct / 100,
        materials: row.materialsOutstanding,
      });
      added.getCell('drawings').numFmt = '0%';
      added.getCell('execution').numFmt = '0%';
    }
  }

  /**
   * A cover sheet carrying the logo.
   *
   * The logo goes on its own sheet rather than floating over the summary. An
   * ExcelJS image is anchored to a cell range and does not push rows down, so
   * dropping one onto a data sheet would sit it on top of the header row and
   * hide it — and every consumer of these workbooks (filters, pivots, a re-import)
   * expects row 1 to be the header.
   */
  private addCoverSheet(
    workbook: ExcelJS.Workbook,
    title: string,
    rows: [string, string | number][],
  ): void {
    const sheet = workbook.addWorksheet('Cover');
    sheet.columns = [
      { key: 'field', width: 30 },
      { key: 'value', width: 40 },
    ];

    const logo = brandAsset();
    let cursor = 2;

    if (logo) {
      // The data URI rather than the buffer: ExcelJS types its buffer input as
      // its own Buffer shape, which no longer matches Node's under recent
      // @types/node, and base64 avoids the cast entirely.
      const id = workbook.addImage({ base64: logo.dataUri, extension: logo.extension });
      const width = 260;
      sheet.addImage(id, {
        tl: { col: 0.2, row: 0.4 },
        ext: { width, height: Math.round(width / logo.aspect) },
        editAs: 'oneCell',
      });
      // Enough blank rows for the image to sit in without overlapping the text
      // beneath it — the image floats, so the space has to be made by hand.
      for (let row = 1; row <= 4; row += 1) sheet.getRow(row).height = 18;
      cursor = 6;
    }

    const heading = sheet.getCell(`A${cursor}`);
    heading.value = title;
    heading.font = { bold: true, size: 16, color: { argb: 'FF111827' } };
    cursor += 2;

    for (const [field, value] of rows) {
      sheet.getCell(`A${cursor}`).value = field;
      sheet.getCell(`A${cursor}`).font = { color: { argb: 'FF6B7280' } };
      sheet.getCell(`B${cursor}`).value = value;
      sheet.getCell(`B${cursor}`).font = { bold: true };
      cursor += 1;
    }

    sheet.views = [{ showGridLines: false }];
  }

  private styleHeader(sheet: ExcelJS.Worksheet): void {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    header.alignment = { vertical: 'middle' };
    header.height = 20;
  }

  // -------------------------------------------------------------------------
  // Excel — single project
  // -------------------------------------------------------------------------

  async projectWorkbook(organisationId: string, projectId: string): Promise<ExportFile> {
    const project = await this.projects.findOne(organisationId, projectId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ConstructIQ Tracker';
    workbook.created = new Date();

    this.addCoverSheet(workbook, project.name, [
      ['Exported', formatDate(new Date())],
      ['Category', project.category.name],
      ['Status', PROJECT_STATUS_LABELS[project.status]],
      ['Design complete', `${project.metrics.designPct}%`],
      ['Execution complete', `${project.metrics.executionPct}%`],
      ['Orders overdue', project.metrics.materialsOverdue],
    ]);

    const overview = workbook.addWorksheet('Overview');
    overview.columns = [
      { header: 'Field', key: 'field', width: 26 },
      { header: 'Value', key: 'value', width: 46 },
    ];
    this.styleHeader(overview);
    const m = project.metrics;
    (
      [
        ['Project', project.name],
        ['Code', project.code ?? '—'],
        ['Category', project.category.name],
        ['Status', PROJECT_STATUS_LABELS[project.status]],
        ['Consultant', project.consultant ?? '—'],
        ['Vendor', project.vendor ?? '—'],
        ['Manager', project.manager?.name ?? '—'],
        ['Site address', project.siteAddress ?? '—'],
        ['Handover', project.handoverDate ? formatDate(parseIsoDate(project.handoverDate)) : '—'],
        ['Days to handover', m.daysToHandover ?? '—'],
        ['Design', `${m.designComplete} of ${m.designTotal} (${m.designPct}%)`],
        ['Execution', `${m.executionPct}%`],
        ['Work items behind plan', m.executionDelayed],
        ['Blocked on materials', m.executionBlocked],
        ['Orders overdue', m.materialsOverdue],
        ['At risk', m.atRisk ? m.riskReasons.join('; ') : 'No'],
      ] as [string, string | number][]
    ).forEach(([field, value]) => overview.addRow({ field, value }));

    this.addProjectDesign(workbook, project);
    this.addProjectMaterials(workbook, project);
    this.addProjectExecution(workbook, project);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `${slug(project.name)}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** Design section: the document list plus the design track of every work item. */
  private addProjectDesign(workbook: ExcelJS.Workbook, project: ProjectDetail): void {
    const files = workbook.addWorksheet('Design files');
    files.columns = [
      { header: 'Document', key: 'name', width: 46 },
      { header: 'Issued', key: 'complete', width: 12 },
      { header: 'Issued on', key: 'completedAt', width: 16 },
      { header: 'Issued by', key: 'completedBy', width: 22 },
    ];
    this.styleHeader(files);
    for (const file of project.designFiles) {
      files.addRow({
        name: file.name,
        complete: file.isComplete ? 'Yes' : 'No',
        completedAt: file.completedAt ? formatDate(new Date(file.completedAt)) : '',
        completedBy: file.completedBy?.name ?? '',
      });
    }
    files.views = [{ state: 'frozen', ySplit: 1 }];

    const design = workbook.addWorksheet('Design by phase');
    design.columns = [
      { header: 'Phase', key: 'phase', width: 20 },
      { header: 'Work item', key: 'name', width: 44 },
      { header: 'Design issued', key: 'complete', width: 14 },
      { header: 'Issued on', key: 'completedAt', width: 16 },
      { header: 'Issued by', key: 'completedBy', width: 22 },
    ];
    this.styleHeader(design);
    for (const item of project.workItems) {
      design.addRow({
        phase: item.phase.name,
        name: item.name,
        complete: item.designComplete ? 'Yes' : 'No',
        completedAt: item.designCompletedAt ? formatDate(new Date(item.designCompletedAt)) : '',
        completedBy: item.designCompletedBy?.name ?? '',
      });
    }
    design.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private addProjectMaterials(workbook: ExcelJS.Workbook, project: ProjectDetail): void {
    const sheet = workbook.addWorksheet('Materials');
    sheet.columns = [
      { header: 'Order by', key: 'orderBy', width: 14 },
      { header: 'State', key: 'state', width: 12 },
      { header: 'Phase', key: 'phase', width: 18 },
      { header: 'Material', key: 'name', width: 34 },
      { header: 'Gates', key: 'gates', width: 30 },
      { header: 'Lead (weeks)', key: 'lead', width: 13 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Supplier', key: 'supplier', width: 24 },
      { header: 'PO number', key: 'po', width: 16 },
      { header: 'Ordered', key: 'ordered', width: 14 },
      { header: 'Delivered', key: 'delivered', width: 14 },
    ];
    this.styleHeader(sheet);

    const ordered = [...project.materials].sort((a, b) =>
      (a.orderByDate ?? '9999').localeCompare(b.orderByDate ?? '9999'),
    );
    for (const material of ordered) {
      const row = sheet.addRow({
        orderBy: material.orderByDate ? parseIsoDate(material.orderByDate) : '',
        state: PROCUREMENT_STATE_LABELS[material.procurementState],
        phase: material.phase.name,
        name: material.name,
        gates: material.linkedWorkItem?.name ?? '',
        lead: material.leadTimeWeeks ?? '',
        status: MATERIAL_STATUS_LABELS[material.status],
        supplier: material.supplier ?? '',
        po: material.poNumber ?? '',
        ordered: material.orderedAt ? parseIsoDate(material.orderedAt) : '',
        delivered: material.deliveredAt ? parseIsoDate(material.deliveredAt) : '',
      });
      for (const key of ['orderBy', 'ordered', 'delivered']) {
        row.getCell(key).numFmt = 'dd mmm yyyy';
      }
      if (material.procurementState === 'OVERDUE') {
        row.getCell('state').font = { color: { argb: 'FFC2544D' }, bold: true };
      }
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  /** Execution section, including what each item is waiting on. */
  private addProjectExecution(workbook: ExcelJS.Workbook, project: ProjectDetail): void {
    const sheet = workbook.addWorksheet('Execution');
    sheet.columns = [
      { header: 'Phase', key: 'phase', width: 18 },
      { header: 'Work item', key: 'name', width: 38 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Planned start', key: 'ps', width: 14 },
      { header: 'Planned end', key: 'pe', width: 14 },
      { header: 'Actual start', key: 'as', width: 14 },
      { header: 'Actual end', key: 'ae', width: 14 },
      { header: 'Slippage (days)', key: 'slip', width: 16 },
      { header: 'Blocked by', key: 'blocked', width: 40 },
      { header: 'Assignee', key: 'assignee', width: 22 },
    ];
    this.styleHeader(sheet);

    for (const item of project.workItems) {
      const row = sheet.addRow({
        phase: item.phase.name,
        name: item.name,
        status: ACTIVITY_STATUS_LABELS[item.executionStatus],
        ps: item.plannedStart ? parseIsoDate(item.plannedStart) : '',
        pe: item.plannedEnd ? parseIsoDate(item.plannedEnd) : '',
        as: item.actualStart ? parseIsoDate(item.actualStart) : '',
        ae: item.actualEnd ? parseIsoDate(item.actualEnd) : '',
        slip: item.slippage ? item.slippage.days : '',
        blocked: item.blockingMaterials.map((m) => m.name).join(', '),
        assignee: item.assignee?.name ?? '',
      });
      for (const key of ['ps', 'pe', 'as', 'ae']) row.getCell(key).numFmt = 'dd mmm yyyy';
      if (item.slippage && item.slippage.days > 0) {
        row.getCell('slip').font = { color: { argb: 'FFC2544D' }, bold: true };
      }
      if (item.blockingMaterials.length > 0) {
        row.getCell('blocked').font = { color: { argb: 'FFC2544D' } };
      }
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // -------------------------------------------------------------------------
  // PDF
  // -------------------------------------------------------------------------

  async portfolioPdf(organisationId: string, query: ReportQueryDto): Promise<ExportFile> {
    const [report, organisation] = await Promise.all([
      this.reports.build(organisationId, query),
      this.settings.getOrganisation(organisationId),
    ]);

    const k = report.kpis;
    const generated = formatDate(new Date());
    const logo = brandAsset();

    const definition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [32, 64, 32, 44],
      defaultStyle: { font: 'Roboto', fontSize: 9, color: INK },

      // The logo rides the running header on every page, so a page pulled out
      // of the pack on its own is still identifiably ours. It falls back to the
      // organisation name when the asset is missing from the deployment.
      // Skipped on page 1. The cover already opens with the large logo, and
      // running it there too printed the mark twice within an inch of itself.
      // Pages 2+ still carry it, so a page pulled out of the pack on its own is
      // identifiable.
      header: (currentPage) =>
        currentPage === 1
          ? undefined
          : {
              margin: [32, 18, 32, 0] as [number, number, number, number],
              columns: [
                logo
                  ? { image: logo.dataUri, width: HEADER_LOGO_WIDTH }
                  : { text: organisation.name.toUpperCase(), style: 'eyebrow' },
                {
                  text: report.title,
                  alignment: 'right',
                  style: 'eyebrow',
                  // Nudged onto the logo's optical centre line, not its top.
                  margin: [0, logo ? 8 : 0, 0, 0] as [number, number, number, number],
                },
              ],
            },
      footer: (currentPage, pageCount) => ({
        margin: [32, 12, 32, 0] as [number, number, number, number],
        columns: [
          { text: `Generated ${generated}`, style: 'footer' },
          { text: `${currentPage} of ${pageCount}`, alignment: 'right', style: 'footer' },
        ],
      }),

      content: [
        ...(logo
          ? [
              {
                image: logo.dataUri,
                width: COVER_LOGO_WIDTH,
                margin: [0, 0, 0, 12] as [number, number, number, number],
              },
            ]
          : [{ text: organisation.name.toUpperCase(), style: 'eyebrow' }]),
        { text: report.title, style: 'title' },
        { text: `Prepared for management · ${generated}`, style: 'subtitle' },

        {
          margin: [0, 14, 0, 14] as [number, number, number, number],
          table: {
            widths: Array(6).fill('*'),
            body: [
              [
                kpiCell(String(k.totalProjects), 'Projects'),
                kpiCell(String(k.activeProjects), 'Active'),
                kpiCell(`${k.designPct}%`, 'Drawings'),
                kpiCell(`${k.executionPct}%`, 'Execution'),
                kpiCell(String(k.ordersOverdue), 'Orders overdue'),
                kpiCell(String(k.projectsAtRisk), 'At risk'),
              ],
            ],
          },
          layout: kpiLayout,
        },

        // The screens replaced this prose block with a status bar and two
        // meters; the pack prints the same marks so a figure read on screen and
        // a figure read on paper are the same shape, not two dialects.
        { text: 'Portfolio', style: 'section' },
        ...statusBand(k),

        ...(report.commentary
          ? [
              { text: 'Management commentary', style: 'section' },
              {
                text: report.commentary,
                style: 'body',
                margin: [0, 0, 0, 10] as [number, number, number, number],
              },
            ]
          : []),

        { text: 'Project status sheet', style: 'section', pageBreak: 'before' as const },
        {
          table: {
            headerRows: 1,
            widths: [110, 74, 62, 52, 44, 34, 34, 30, 30, 46],
            body: [
              [
                'Project',
                'Category',
                'Status',
                'Handover',
                'Days',
                'Draw',
                'Exec',
                'Ord',
                'Late',
                'Flag',
              ].map((text) => ({ text, style: 'th' })),
              ...report.statusSheet.map((project) => {
                const m = project.metrics;
                const flag =
                  project.status === 'COMPLETED' ? 'Done' : m.atRisk ? 'At risk' : 'On track';
                return [
                  { text: project.name, style: 'tdStrong' },
                  { text: project.category.name, style: 'td' },
                  { text: PROJECT_STATUS_LABELS[project.status], style: 'td' },
                  {
                    text: project.handoverDate
                      ? formatDate(parseIsoDate(project.handoverDate))
                      : '—',
                    style: 'td',
                  },
                  { text: m.daysToHandover != null ? String(m.daysToHandover) : '—', style: 'td' },
                  { text: `${m.designPct}%`, style: 'td' },
                  { text: `${m.executionPct}%`, style: 'td' },
                  {
                    text: m.materialsOverdue > 0 ? String(m.materialsOverdue) : '—',
                    style: m.materialsOverdue > 0 ? 'tdAlert' : 'td',
                  },
                  {
                    text: m.executionDelayed > 0 ? String(m.executionDelayed) : '—',
                    style: m.executionDelayed > 0 ? 'tdAlert' : 'td',
                  },
                  { text: flag, style: flag === 'At risk' ? 'tdAlert' : 'td' },
                ];
              }),
            ],
          },
          layout: tableLayout,
        },

        ...(report.procurementAlerts.length > 0
          ? [
              {
                text: 'Orders needing action',
                style: 'section',
                margin: [0, 16, 0, 6] as [number, number, number, number],
              },
              {
                table: {
                  headerRows: 1,
                  widths: [58, 34, 46, 130, 130, 70, 90],
                  body: [
                    ['Order by', 'Days', 'State', 'Material', 'Project', 'Phase', 'Supplier'].map(
                      (text) => ({ text, style: 'th' }),
                    ),
                    ...report.procurementAlerts.map((alert) => [
                      { text: formatDate(parseIsoDate(alert.orderByDate)), style: 'td' },
                      { text: String(alert.daysUntilOrderBy), style: 'td' },
                      {
                        text: PROCUREMENT_STATE_LABELS[alert.procurementState],
                        style: alert.procurementState === 'OVERDUE' ? 'tdAlert' : 'td',
                      },
                      { text: alert.materialName, style: 'tdStrong' },
                      { text: alert.projectName, style: 'td' },
                      { text: alert.phaseName, style: 'td' },
                      { text: alert.supplier ?? '—', style: 'td' },
                    ]),
                  ],
                },
                layout: tableLayout,
              },
            ]
          : []),
      ],

      styles: {
        eyebrow: { fontSize: 7.5, color: MUTED, characterSpacing: 1 },
        footer: { fontSize: 7.5, color: MUTED },
        title: { fontSize: 20, bold: true, color: INK },
        subtitle: {
          fontSize: 9,
          color: MUTED,
          margin: [0, 3, 0, 0] as [number, number, number, number],
        },
        section: {
          fontSize: 11,
          bold: true,
          color: INK,
          margin: [0, 6, 0, 5] as [number, number, number, number],
        },
        body: { fontSize: 9.5, lineHeight: 1.35, color: '#374151' },
        legend: { fontSize: 8, color: MUTED },
        meterLabel: { fontSize: 9, bold: true, color: INK },
        meterValue: { fontSize: 9, bold: true, color: INK },
        th: {
          fontSize: 7.5,
          bold: true,
          color: MUTED,
          margin: [0, 4, 0, 4] as [number, number, number, number],
        },
        td: { fontSize: 8.5, margin: [0, 3, 0, 3] as [number, number, number, number] },
        tdStrong: {
          fontSize: 8.5,
          bold: true,
          margin: [0, 3, 0, 3] as [number, number, number, number],
        },
        tdAlert: {
          fontSize: 8.5,
          bold: true,
          color: '#c2544d',
          margin: [0, 3, 0, 3] as [number, number, number, number],
        },
      },
    };

    const buffer = await this.renderPdf(definition);
    return {
      buffer,
      fileName: `portfolio-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  /** pdfmake is stream-based; collect it into a buffer for the HTTP response. */
  private renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const printer = new PdfPrinter(PDF_FONTS);
        const doc = printer.createPdfKitDocument(definition);
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

/**
 * Status mix as a stacked bar, plus a design and an execution meter.
 *
 * Drawn with pdfmake's `canvas` rects rather than an embedded chart image: it
 * stays vector, weighs nothing, and needs no rendering dependency on the server.
 *
 * Every fill is separated from its neighbour by a 2px gap in the page colour,
 * the same rule the CSS uses — adjacent fills with no gap read as one shape.
 * A legend is always present, so identity never rests on colour alone.
 */
function statusBand(k: PortfolioReport['kpis']): Content[] {
  const total = k.totalProjects;
  if (total === 0) {
    return [{ text: 'No projects in this view.', style: 'body' }];
  }

  const present = PROJECT_STATUSES.filter((status) => k.byStatus[status] > 0);

  const segments: CanvasElement[] = [];
  let x = 0;
  for (const status of present) {
    // The last segment absorbs the rounding so the bar always ends flush at
    // BAR_WIDTH rather than a fraction short.
    const isLast = status === present[present.length - 1];
    const width = isLast
      ? BAR_WIDTH - x
      : Math.round((k.byStatus[status] / total) * BAR_WIDTH) - GAP;

    segments.push({
      type: 'rect',
      x,
      y: 0,
      w: Math.max(width, 1),
      h: BAR_HEIGHT,
      color: CHART_SERIES[status],
    });
    x += width + GAP;
  }

  return [
    { canvas: segments, margin: [0, 2, 0, 6] as [number, number, number, number] },

    {
      columns: present.map((status) => ({
        columns: [
          {
            canvas: [
              { type: 'rect', x: 0, y: 2, w: 7, h: 7, r: 1.5, color: CHART_SERIES[status] },
            ] as CanvasElement[],
            width: 11,
          },
          {
            text: `${PROJECT_STATUS_LABELS[status]}  ${k.byStatus[status]}`,
            style: 'legend',
          },
        ],
      })),
      margin: [0, 0, 0, 10] as [number, number, number, number],
    },

    {
      columns: [
        meter('Design', k.designPct, `${k.designComplete} of ${k.designTotal} issued`, CHART_DESIGN),
        meter(
          'Execution',
          k.executionPct,
          `${k.workItemsTotal} work item${k.workItemsTotal === 1 ? '' : 's'}`,
          CHART_EXECUTION,
        ),
      ],
      columnGap: 24,
      margin: [0, 0, 0, 12] as [number, number, number, number],
    },
  ];
}

/** One labelled progress meter — magnitude against a known 100%. */
function meter(label: string, pct: number, detail: string, colour: string): Content {
  const width = 340;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);

  return {
    stack: [
      {
        columns: [
          { text: label, style: 'meterLabel' },
          { text: `${pct}%`, style: 'meterValue', alignment: 'right' },
        ],
        margin: [0, 0, 0, 3] as [number, number, number, number],
      },
      {
        canvas: [
          { type: 'rect', x: 0, y: 0, w: width, h: 6, r: 3, color: '#eef0f4' },
          ...(filled > 0
            ? [{ type: 'rect' as const, x: 0, y: 0, w: filled, h: 6, r: 3, color: colour }]
            : []),
        ] as CanvasElement[],
      },
      { text: detail, style: 'legend', margin: [0, 3, 0, 0] as [number, number, number, number] },
    ],
  };
}

function kpiCell(value: string, label: string): Content {
  return {
    stack: [
      { text: value, fontSize: 17, bold: true, color: INK },
      {
        text: label.toUpperCase(),
        fontSize: 6.5,
        color: MUTED,
        characterSpacing: 0.8,
        margin: [0, 3, 0, 0] as [number, number, number, number],
      },
    ],
    margin: [8, 8, 8, 8] as [number, number, number, number],
  };
}

const kpiLayout = {
  hLineWidth: () => 0.7,
  vLineWidth: () => 0.7,
  hLineColor: () => RULE,
  vLineColor: () => RULE,
};

const tableLayout = {
  hLineWidth: (i: number) => (i === 1 ? 0.9 : 0.4),
  vLineWidth: () => 0,
  hLineColor: (i: number) => (i === 1 ? '#9ca3af' : RULE),
  paddingLeft: () => 5,
  paddingRight: () => 5,
};

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}
