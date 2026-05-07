import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  await prisma.indexingJob.update({
    where: { id: params.id },
    data: { status: 'FAILED', errorMessage: 'Stopped manually by Admin' }
  });

  return Response.json({ success: true });
}
