import type { FastifyInstance } from 'fastify';
import { projectScannerService } from '../services/project-scanner.service.js';
import { eventBus } from '../ws/event-bus.js';

export const projectRoutes = async (app: FastifyInstance) => {
  // List all projects
  app.get('/api/projects', async () => {
    return projectScannerService.listProjects();
  });

  // Get single project
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const project = projectScannerService.getProject(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Enrich with parsed handoff data if available
    const handoffContent = projectScannerService.getProjectHandoffContent(request.params.id);
    const handoff = handoffContent ? projectScannerService.parseHandoffMd(handoffContent) : null;

    return { ...project, handoff };
  });

  // Trigger project re-scan
  app.post('/api/projects/scan', async () => {
    const projects = projectScannerService.scanDirectories();
    await projectScannerService.enrichWithCommits(projects);
    projectScannerService.syncToDb(projects);
    const listed = projectScannerService.listProjects();
    eventBus.emitProjectsScanned(listed);
    return { scanned: projects.length, projects: listed };
  });

  // Per-project rescan (#230) — refreshes state/handoff parse, stack
  // manifests, and recent commits. Used by the ProjectDetailPage's
  // manual refresh button. Idempotent; broadcasts project:updated.
  app.post<{ Params: { id: string } }>('/api/projects/:id/rescan', async (request, reply) => {
    const project = projectScannerService.getProject(request.params.id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    // scanDirectories doesn't accept a single path — scan the parent dir
    // and pick our match by path. This preserves the STATE.md parse path.
    const parentDir = project.path.replace(/\/[^/]+$/, '');
    const scanned = projectScannerService.scanDirectories([parentDir]);
    const fresh = scanned.find((p) => p.path === project.path);
    if (!fresh) {
      return reply.status(404).send({ error: 'Project path no longer scannable' });
    }
    fresh.id = project.id;
    await projectScannerService.enrichWithCommits([fresh]);
    projectScannerService.syncToDb([fresh]);
    const refreshed = projectScannerService.getProject(project.id);
    if (refreshed) eventBus.emitProjectUpdated(refreshed);
    return refreshed;
  });

  // Get raw STATE.md content
  app.get<{ Params: { id: string } }>('/api/projects/:id/state', async (request, reply) => {
    const content = projectScannerService.getProjectStateContent(request.params.id);
    if (content === null) {
      return reply.status(404).send({ error: 'STATE.md not found' });
    }
    return { content };
  });

  // Get raw PM_HANDOFF.md content
  app.get<{ Params: { id: string } }>('/api/projects/:id/handoff', async (request, reply) => {
    const content = projectScannerService.getProjectHandoffContent(request.params.id);
    if (content === null) {
      return reply.status(404).send({ error: 'PM_HANDOFF.md not found' });
    }
    return { content };
  });
};
