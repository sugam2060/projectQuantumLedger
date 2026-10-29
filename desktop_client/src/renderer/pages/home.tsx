import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const schema = z.object({
  workspace: z.string().min(2, 'Enter at least 2 characters.'),
});

type FormValues = z.infer<typeof schema>;

export default function App() {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { workspace: '' },
  });

  function onSubmit(values: FormValues) {
    toast.success(`Workspace “${values.workspace}” is ready.`);
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-lg border-white/10 bg-card/95 shadow-2xl shadow-black/30">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" /> Quantum Ledger
          </div>
          <CardTitle className="text-3xl tracking-tight">Your workspace starts here.</CardTitle>
          <CardDescription>React renderer, ready for your product screens and workflows.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="workspace"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Workspace name</FormLabel>
                    <FormControl>
                      <input
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="e.g. Acme Finance"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full">Create workspace</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
