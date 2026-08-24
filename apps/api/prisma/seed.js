"use strict";
/* eslint-disable no-console */
/**
 * Development seed.
 *
 * IMPORTANT: nothing in this file is product behaviour. Every phase, category,
 * template and project below is *sample data* written through the same tables an
 * administrator would use from the Settings screens. A real deployment starts
 * empty and the organisation defines its own.
 *
 * The intent is to give a developer a populated app in one command, and to prove
 * the point of the dynamic model: swap the arrays below for anything at all and
 * the application works identically.
 *
 *   npm run db:seed -w @ciq/api
 *
 * Refuses to run against NODE_ENV=production.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const shared_1 = require("@ciq/shared");
const prisma = new client_1.PrismaClient();
const DEMO_PASSWORD = 'ConstructIQ-Demo-2026';
const BCRYPT_ROUNDS = 12;
// ---------------------------------------------------------------------------
// Sample configuration — replace freely; the app does not depend on any of it
// ---------------------------------------------------------------------------
const SAMPLE_PHASES = [
    { name: 'Design', colour: '#3b6fe0' },
    { name: 'Civil', colour: '#d98a20' },
    { name: 'Finishing', colour: '#22a06b' },
];
const SAMPLE_CATEGORIES = [
    { name: 'Marketing Offices', description: 'Customer-facing sales and marketing suites.' },
    { name: 'Corporate Offices', description: 'Head-office and back-office fit-outs.' },
    { name: 'Clubhouse / Lobby', description: 'Amenity and common-area interiors.' },
    { name: 'Mock Up', description: 'Show units and sample flats.' },
];
/** Template rows: [phaseName, name, leadTimeWeeks?, offsetStartDays?, offsetEndDays?] */
const SAMPLE_TEMPLATE = {
    name: 'Standard fit-out',
    description: 'The default playbook: full drawing set, civil and finishing activities, and a ' +
        'material schedule with supplier lead times. Duplicate and edit for other project types.',
    drawings: [
        ['Design', 'Concept & mood board'],
        ['Design', 'Space planning / layout'],
        ['Design', 'Furniture layout'],
        ['Design', 'Reflected ceiling plan (RCP)'],
        ['Design', 'Electrical & lighting layout'],
        ['Design', 'Flooring layout'],
        ['Design', 'Wall elevations'],
        ['Design', 'Joinery / millwork details'],
        ['Design', 'HVAC coordination layout'],
        ['Design', 'Plumbing & CP fixture layout'],
        ['Design', 'Glazing / partition details'],
        ['Design', 'GFC drawing set'],
        ['Civil', 'Demolition plan'],
        ['Civil', 'Partition / blockwork layout'],
        ['Civil', 'Waterproofing & plaster'],
        ['Civil', 'Floor screed / base'],
        ['Civil', 'Electrical conduiting'],
        ['Civil', 'Plumbing rough-in'],
        ['Civil', 'HVAC ducting layout'],
        ['Civil', 'Fire & safety layout'],
        ['Finishing', 'Ceiling finish'],
        ['Finishing', 'Wall finishes (paint / veneer)'],
        ['Finishing', 'Flooring laydown'],
        ['Finishing', 'Light fixture installation'],
        ['Finishing', 'CP & sanitary installation'],
        ['Finishing', 'Glass partitions / glazing'],
        ['Finishing', 'Loose furniture'],
        ['Finishing', 'Signage & branding'],
        ['Finishing', 'Snagging & handover'],
    ],
    // Offsets are days relative to handover; negative means before.
    activities: [
        ['Design', 'Design & drawings', -140, -84],
        ['Civil', 'Demolition', -112, -98],
        ['Civil', 'Blockwork / partitions', -105, -77],
        ['Civil', 'Plastering', -84, -63],
        ['Civil', 'Waterproofing', -80, -66],
        ['Civil', 'Floor screed / base', -70, -56],
        ['Civil', 'Electrical conduiting & wiring', -98, -49],
        ['Civil', 'Plumbing rough-in', -98, -49],
        ['Civil', 'HVAC ducting', -98, -42],
        ['Civil', 'Fire & safety rough-in', -84, -42],
        ['Finishing', 'Ceiling installation', -49, -28],
        ['Finishing', 'Wall finishes / painting', -42, -14],
        ['Finishing', 'Flooring laydown', -56, -21],
        ['Finishing', 'Joinery / veneer installation', -42, -14],
        ['Finishing', 'Glazing / glass partitions', -49, -28],
        ['Finishing', 'Light fixture installation', -35, -14],
        ['Finishing', 'CP & sanitary fitting', -35, -14],
        ['Finishing', 'Loose furniture placement', -21, -7],
        ['Finishing', 'Signage & branding', -21, -7],
        ['Finishing', 'Deep cleaning', -10, -4],
        ['Finishing', 'Snagging & handover', -14, 0],
    ],
    materials: [
        ['Civil', 'HVAC equipment', 12],
        ['Civil', 'Glazing system', 10],
        ['Civil', 'Doors & hardware', 8],
        ['Finishing', 'Flooring material', 8],
        ['Finishing', 'Loose furniture', 8],
        ['Finishing', 'Light fixtures', 6],
        ['Finishing', 'CP & sanitary fixtures', 6],
        ['Finishing', 'Ceiling system', 5],
        ['Finishing', 'Joinery / veneer', 5],
        ['Finishing', 'Paint & wall finishes', 2],
    ],
};
const SAMPLE_USERS = [
    { name: 'Asha Rao', email: 'owner@demo.local', role: 'OWNER' },
    { name: 'Vikram Shetty', email: 'admin@demo.local', role: 'ADMIN' },
    { name: 'Priya Menon', email: 'pm@demo.local', role: 'PROJECT_MANAGER' },
    { name: 'Rahul Nair', email: 'engineer@demo.local', role: 'SITE_ENGINEER' },
    { name: 'Shivangi Desai', email: 'consultant@demo.local', role: 'CONSULTANT' },
    { name: 'Meera Iyer', email: 'viewer@demo.local', role: 'VIEWER' },
];
/** `handoverInDays` is relative to today, so the demo never goes stale. */
const SAMPLE_PROJECTS = [
    { name: 'Whitefield Marketing Office', category: 'Marketing Offices', consultant: 'WSI — Shivangi', status: 'IN_PROGRESS', handoverInDays: 96, vendor: 'Bharath Furniture', drawingProgress: 0.75, executionProgress: 0.45 },
    { name: 'Electronic City Marketing Office', category: 'Marketing Offices', consultant: 'WSI — Aashni', status: 'IN_PROGRESS', handoverInDays: 38, vendor: 'Sterling Interiors', drawingProgress: 0.4, executionProgress: 0.3 },
    { name: 'Hebbal Sales Lounge', category: 'Marketing Offices', consultant: 'SS Associates', status: 'DISCUSSION', handoverInDays: null, vendor: null, drawingProgress: 0.05, executionProgress: 0 },
    { name: 'Barton Centre — Level 7', category: 'Corporate Offices', consultant: 'WSI', status: 'IN_PROGRESS', handoverInDays: 175, vendor: null, drawingProgress: 0.55, executionProgress: 0.2 },
    { name: 'Barton Centre — Level 3 Renovation', category: 'Corporate Offices', consultant: 'WSI', status: 'ON_HOLD', handoverInDays: 260, vendor: null, drawingProgress: 0.2, executionProgress: 0.05 },
    { name: 'Yelahanka Clubhouse', category: 'Clubhouse / Lobby', consultant: 'Studio Verde', status: 'IN_PROGRESS', handoverInDays: 21, vendor: 'Anand Contracts', drawingProgress: 0.9, executionProgress: 0.7 },
    { name: 'Sarjapur Lobby Refresh', category: 'Clubhouse / Lobby', consultant: 'Studio Verde', status: 'COMPLETED', handoverInDays: -45, vendor: 'Anand Contracts', drawingProgress: 1, executionProgress: 1 },
    { name: 'Devanahalli Show Flat', category: 'Mock Up', consultant: 'SS Associates', status: 'COMPLETED', handoverInDays: -110, vendor: null, drawingProgress: 1, executionProgress: 1 },
];
// ---------------------------------------------------------------------------
async function main() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('The seed script refuses to run with NODE_ENV=production.');
    }
    console.log('Seeding sample data…\n');
    const existing = await prisma.organisation.findFirst({ where: { slug: 'demo-construction' } });
    if (existing) {
        console.log('  Removing the previous demo organisation…');
        await prisma.organisation.delete({ where: { id: existing.id } });
    }
    const organisation = await prisma.organisation.create({
        data: {
            name: 'Demo Construction Co.',
            slug: 'demo-construction',
            settings: shared_1.DEFAULT_SETTINGS,
            reportSetting: {
                create: {
                    title: 'Portfolio Status Report',
                    commentary: 'Sample commentary. Everything on this screen is computed from the rows below — ' +
                        'change a lead time or tick a drawing and the figures move immediately.',
                },
            },
        },
    });
    console.log(`  Organisation: ${organisation.name}`);
    // --- People --------------------------------------------------------------
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
    const users = await Promise.all(SAMPLE_USERS.map((user) => prisma.user.create({
        data: { organisationId: organisation.id, ...user, passwordHash },
    })));
    console.log(`  Users: ${users.length}`);
    const manager = users.find((u) => u.role === 'PROJECT_MANAGER');
    const engineer = users.find((u) => u.role === 'SITE_ENGINEER');
    // --- Configuration -------------------------------------------------------
    const phases = {};
    for (const [position, phase] of SAMPLE_PHASES.entries()) {
        phases[phase.name] = await prisma.phase.create({
            data: { organisationId: organisation.id, ...phase, position },
        });
    }
    console.log(`  Phases: ${Object.keys(phases).length} (${Object.keys(phases).join(', ')})`);
    const categories = {};
    for (const [position, category] of SAMPLE_CATEGORIES.entries()) {
        categories[category.name] = await prisma.category.create({
            data: { organisationId: organisation.id, ...category, position },
        });
    }
    console.log(`  Categories: ${Object.keys(categories).length}`);
    const template = await prisma.template.create({
        data: {
            organisationId: organisation.id,
            name: SAMPLE_TEMPLATE.name,
            description: SAMPLE_TEMPLATE.description,
            isDefault: true,
            items: {
                create: [
                    ...SAMPLE_TEMPLATE.drawings.map(([phaseName, name], position) => ({
                        phaseId: phases[phaseName].id,
                        kind: 'DRAWING',
                        name,
                        position,
                    })),
                    ...SAMPLE_TEMPLATE.activities.map(([phaseName, name, start, end], position) => ({
                        phaseId: phases[phaseName].id,
                        kind: 'ACTIVITY',
                        name,
                        position,
                        offsetStartDays: start,
                        offsetEndDays: end,
                    })),
                    ...SAMPLE_TEMPLATE.materials.map(([phaseName, name, leadTimeWeeks], position) => ({
                        phaseId: phases[phaseName].id,
                        kind: 'MATERIAL',
                        name,
                        position,
                        leadTimeWeeks,
                    })),
                ],
            },
        },
        include: { items: true },
    });
    console.log(`  Template: "${template.name}" with ${template.items.length} items`);
    // --- Projects ------------------------------------------------------------
    const today = (0, shared_1.todayUtc)();
    let projectCount = 0;
    for (const [index, spec] of SAMPLE_PROJECTS.entries()) {
        const handoverDate = spec.handoverInDays === null ? null : (0, shared_1.addDays)(today, spec.handoverInDays);
        const project = await prisma.project.create({
            data: {
                organisationId: organisation.id,
                categoryId: categories[spec.category].id,
                name: spec.name,
                code: `PRJ-${String(index + 1).padStart(3, '0')}`,
                consultant: spec.consultant,
                vendor: spec.vendor,
                status: spec.status,
                handoverDate,
                currency: shared_1.DEFAULT_SETTINGS.defaultCurrency,
                managerId: manager.id,
                position: index,
                members: {
                    create: [
                        { userId: manager.id, projectRole: 'Project Manager' },
                        { userId: engineer.id, projectRole: 'Site Engineer' },
                    ],
                },
            },
        });
        // Apply the template exactly as ProjectsService.create would.
        const drawings = template.items.filter((i) => i.kind === 'DRAWING');
        const activities = template.items.filter((i) => i.kind === 'ACTIVITY');
        const materials = template.items.filter((i) => i.kind === 'MATERIAL');
        const drawingsDone = Math.round(drawings.length * spec.drawingProgress);
        await prisma.drawing.createMany({
            data: drawings.map((item, position) => ({
                projectId: project.id,
                phaseId: item.phaseId,
                name: item.name,
                position,
                isComplete: position < drawingsDone,
                completedAt: position < drawingsDone ? (0, shared_1.addDays)(today, -(drawings.length - position)) : null,
                completedById: position < drawingsDone ? users[position % users.length].id : null,
            })),
        });
        const activitiesDone = Math.round(activities.length * spec.executionProgress);
        await prisma.activity.createMany({
            data: activities.map((item, position) => {
                const plannedStart = handoverDate && item.offsetStartDays != null
                    ? (0, shared_1.addDays)(handoverDate, item.offsetStartDays)
                    : null;
                const plannedEnd = handoverDate && item.offsetEndDays != null
                    ? (0, shared_1.addDays)(handoverDate, item.offsetEndDays)
                    : null;
                const done = position < activitiesDone;
                const inFlight = position === activitiesDone && spec.status !== 'COMPLETED';
                // A little jitter so the demo shows real slippage rather than a
                // suspiciously perfect programme.
                const drift = done ? (position % 4) - 1 : 0;
                return {
                    projectId: project.id,
                    phaseId: item.phaseId,
                    name: item.name,
                    position,
                    plannedStart,
                    plannedEnd,
                    actualStart: done || inFlight ? plannedStart : null,
                    actualEnd: done && plannedEnd ? (0, shared_1.addDays)(plannedEnd, drift) : null,
                    status: done ? 'DONE' : inFlight ? 'IN_PROGRESS' : 'NOT_STARTED',
                    assigneeId: engineer.id,
                };
            }),
        });
        // Order the longest-lead items on live projects so procurement has a mix of
        // ordered, due-soon and overdue rows to look at.
        const orderedCount = Math.round(materials.length * spec.executionProgress);
        await prisma.material.createMany({
            data: materials.map((item, position) => ({
                projectId: project.id,
                phaseId: item.phaseId,
                name: item.name,
                position,
                leadTimeWeeks: item.leadTimeWeeks ?? shared_1.DEFAULT_SETTINGS.defaultLeadTimeWeeks,
                status: spec.status === 'COMPLETED'
                    ? 'DELIVERED'
                    : position < orderedCount
                        ? 'ORDERED'
                        : 'PENDING',
                orderedAt: position < orderedCount ? (0, shared_1.addDays)(today, -30 + position) : null,
                supplier: position % 3 === 0 ? 'Sterling Supply Co.' : null,
                poNumber: position < orderedCount ? `PO-${project.code}-${position + 1}` : null,
            })),
        });
        projectCount += 1;
    }
    console.log(`  Projects: ${projectCount}\n`);
    const counts = await Promise.all([
        prisma.drawing.count(),
        prisma.activity.count(),
        prisma.material.count(),
    ]);
    console.log(`  Drawings: ${counts[0]} · Activities: ${counts[1]} · Materials: ${counts[2]}\n`);
    console.log('Sign in with any of these — all share the same password:\n');
    for (const user of SAMPLE_USERS) {
        console.log(`  ${user.role.padEnd(16)} ${user.email}`);
    }
    console.log(`\n  Password: ${DEMO_PASSWORD}\n`);
    console.log('Every phase, category, template and threshold above is editable in Settings.');
}
main()
    .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map