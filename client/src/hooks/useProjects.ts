import { useState, useEffect, useCallback, useRef } from 'react';
import type { Project, WSEvent } from '@commander/shared';
import { api } from '../services/api';
import { useWebSocket } from './useWebSocket';

interface UseProjectsReturn {
  projects: Project[];
  loading: boolean;
  error: string | null;
  rescan: () => Promise<void>;
  scanning: boolean;
}

export const useProjects = (): UseProjectsReturn => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const { subscribe, unsubscribe, lastEvent } = useWebSocket();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const fetchProjects = async () => {
      try {
        const data = await api.get<Project[]>('/projects');
        if (mountedRef.current) {
          setProjects(data);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to fetch projects');
          setLoading(false);
        }
      }
    };

    fetchProjects();
    return () => { mountedRef.current = false; };
  }, []);

  // Subscribe to projects channel
  useEffect(() => {
    subscribe(['projects']);
    return () => unsubscribe(['projects']);
  }, [subscribe, unsubscribe]);

  // Handle WebSocket events
  useEffect(() => {
    if (!lastEvent) return;
    const event = lastEvent as WSEvent;

    if (event.type === 'project:updated') {
      setProjects((prev) =>
        prev.map((p) => (p.id === event.project.id ? event.project : p))
      );
    }

    if (event.type === 'project:scanned') {
      setProjects(event.projects);
    }
  }, [lastEvent]);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.post<{ scanned: number; projects: Project[] }>('/projects/scan');
      setProjects(res.projects);
    } catch {
      // silently fail
    } finally {
      setScanning(false);
    }
  }, []);

  return { projects, loading, error, rescan, scanning };
};

// Types for project detail responses
export interface ParsedHandoff {
  modules: Array<{ name: string; priority: string; description: string }>;
  phases: Array<{ number: number; name: string; complete: boolean }>;
}

export interface ProjectDetail extends Project {
  handoff: ParsedHandoff | null;
}
