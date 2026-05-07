import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  await prisma.indexingJob.update({
    where: { id },
    data: { status: 'FAILED', errorMessage: 'Stopped manually by Admin' }
  });

  return Response.json({ success: true });
}
