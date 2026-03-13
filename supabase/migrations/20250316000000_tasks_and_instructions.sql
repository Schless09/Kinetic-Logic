-- Tasks: vendor-defined instructions for what the collector should record (e.g. "Change a tire", steps).

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_vendor_id ON public.tasks(vendor_id);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Same vendor can manage tasks; collectors in vendor can read
CREATE POLICY tasks_select_vendor ON public.tasks
  FOR SELECT USING (
    vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_insert_vendor ON public.tasks
  FOR INSERT WITH CHECK (
    vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin'))
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_update_vendor ON public.tasks
  FOR UPDATE USING (
    vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin'))
    OR public.is_platform_admin()
  );
CREATE POLICY tasks_delete_vendor ON public.tasks
  FOR DELETE USING (
    vendor_id = (SELECT vendor_id FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'platform_admin'))
    OR public.is_platform_admin()
  );

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sessions can be linked to a task (collector selected "Change a tire" etc.)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_task_id ON public.sessions(task_id);

COMMENT ON TABLE public.tasks IS 'Vendor-defined tasks: name + instructions for what the collector should record';
COMMENT ON COLUMN public.sessions.task_id IS 'Optional task this session is recording (e.g. change a tire)';
