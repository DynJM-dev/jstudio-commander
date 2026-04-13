import type { FastifyInstance } from 'fastify';
import { projectScannerService } from '../services/project-scanner.service.js';

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
    projectScannerService.syncToDb(projects);
    return { scanned: projects.length, projects: projectScannerService.listProjects() };
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
