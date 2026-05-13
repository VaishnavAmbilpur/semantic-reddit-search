import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const postCount = await prisma.post.count();
  const commentCount = await prisma.comment.count();
  const subCount = await prisma.subreddit.count();

  console.log(`Database Stats:`);
  console.log(`Posts: ${postCount}`);
  console.log(`Comments: ${commentCount}`);
  console.log(`Subreddits: ${subCount}`);

  const jpmcPosts = await prisma.post.findMany({
    where: {
      OR: [
        { title: { contains: 'JPMC', mode: 'insensitive' } },
        { content: { contains: 'JPMC', mode: 'insensitive' } },
      ],
    },
    take: 5,
  });

  console.log(`\nJPMC matches in DB: ${jpmcPosts.length}`);
  jpmcPosts.forEach(p => console.log(`- ${p.title}`));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
