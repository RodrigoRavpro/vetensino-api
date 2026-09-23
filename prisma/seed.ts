import 'dotenv/config';
import { PrismaClient, CourseStatus, ClassFormat, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV !== 'development') {
    console.log('Seed de desenvolvimento ignorado fora do ambiente development.');
    return;
  }

  const devPassword = await bcrypt.hash('VetEnsino@Dev2026', 12);
  const devUsers = [
    { email: 'dev-admin@vetensino.local', name: 'Dev Admin', role: UserRole.ADMIN },
    { email: 'dev-teacher@vetensino.local', name: 'Dev Docente', role: UserRole.TEACHER },
    { email: 'dev-student@vetensino.local', name: 'Dev Aluno', role: UserRole.STUDENT },
  ];

  for (const devUser of devUsers) {
    await prisma.user.upsert({
      where: { email: devUser.email },
      update: { name: devUser.name, role: devUser.role, password: devPassword, isActive: true },
      create: { ...devUser, password: devPassword, isActive: true },
    });
  }

  const existingCourses = await prisma.course.count();
  if (existingCourses > 0) {
    console.log(`Seed skipped: ${existingCourses} cursos já existem no banco.`);
    return;
  }

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@vetensino.local' },
    update: {},
    create: {
      name: 'Admin VetEnsino',
      email: 'admin@vetensino.local',
      password: null,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  const courseSeed = [
    {
      slug: 'medicina-veterinaria',
      title: 'Medicina Veterinária',
      subtitle: 'Atendimento clínico e rotina da clínica',
      description:
        'Aprenda a aplicar protocolos clínicos, melhorar o atendimento e fortalecer a eficiência da rotina veterinária.',
      price: 499,
      promoPrice: 399,
      workloadHours: 12,
      status: CourseStatus.PUBLISHED,
      accessDurationDays: 365,
      certificateEnabled: true,
      coverImageUrl: '',
      contentJson: {
        badge: 'Mais vendido',
        category: 'Saúde e diagnóstico',
        level: 'Iniciante',
        duration: '12 módulos',
        outcomes: [
          'Fortalecer decisões clínicas com mais segurança',
          'Organizar melhor a rotina da clínica',
          'Aumentar a qualidade do atendimento veterinário',
        ],
        syllabus: [
          'Fundamentos de atendimento clínico e medicina preventiva',
          'Gestão de protocolos, fichas e fluxo de consulta',
          'Farmacologia aplicada e prescrição segura',
          'Casos reais com interpretação clínica e raciocínio',
          'Atendimento ao cliente, conversão e retenção de pacientes',
        ],
        bonuses: [
          'Acesso vitalício ao conteúdo',
          'Material complementar em PDF',
          'Lista de verificação de atendimento',
          'Contato com tutores durante o curso',
        ],
        audience:
          'Ideal para veterinários, auxiliares, estudantes e profissionais que desejam melhorar a qualidade do atendimento e fortalecer sua atuação em clínicas, hospitais e consultórios.',
      },
      classes: {
        create: [
          {
            name: 'Turma Agosto 2026',
            code: 'MVT-AGO-2026',
            capacity: 60,
            format: ClassFormat.ONLINE,
            status: 'OPEN',
            notes: 'Turma regular com acesso ao material digital.',
          },
        ],
      },
    },
    {
      slug: 'cirurgia-e-procedimentos',
      title: 'Cirurgia e Procedimentos',
      subtitle: 'Segurança, técnica e pós-operatório',
      description:
        'Entenda a preparação, execução e recuperação de procedimentos com foco em segurança clínica e protocolos.',
      price: 399,
      promoPrice: 299,
      workloadHours: 10,
      status: CourseStatus.PUBLISHED,
      accessDurationDays: 365,
      certificateEnabled: true,
      coverImageUrl: '',
      contentJson: {
        badge: 'Popular',
        category: 'Procedimentos',
        level: 'Intermediário',
        duration: '10 módulos',
        outcomes: [
          'Reduzir riscos em procedimentos',
          'Organizar melhor os protocolos de cirurgia',
          'Aumentar a segurança do paciente e da equipe',
        ],
        syllabus: [
          'Preparação do paciente e da equipe',
          'Anestesia e monitoramento clínico',
          'Técnicas de cirurgia e sutura',
          'Cuidados pós-operatórios',
          'Documentação e comunicação de alta',
        ],
        bonuses: [
          'Checklist cirúrgico em PDF',
          'Fluxo de acompanhamento clínico',
          'Materiais em vídeo com exemplos práticos',
          'Acesso ao grupo de dúvidas',
        ],
        audience:
          'Público ideal para profissionais que atuam em hospitais veterinários, clínicas e procedimentos cirúrgicos.',
      },
      classes: {
        create: [
          {
            name: 'Turma Setembro 2026',
            code: 'CIR-SET-2026',
            capacity: 45,
            format: ClassFormat.ONLINE,
            status: 'OPEN',
            notes: 'Curso com material prático e suporte de dúvidas.',
          },
        ],
      },
    },
    {
      slug: 'gestao-clinica',
      title: 'Gestão Clínica',
      subtitle: 'Operação, faturamento e experiência do cliente',
      description:
        'Melhore a gestão da clínica, processos internos, faturamento e experiência do cliente com uma abordagem prática.',
      price: 349,
      promoPrice: 249,
      workloadHours: 9,
      status: CourseStatus.PUBLISHED,
      accessDurationDays: 365,
      certificateEnabled: true,
      coverImageUrl: '',
      contentJson: {
        badge: 'Novo',
        category: 'Negócios',
        level: 'Todos os níveis',
        duration: '9 módulos',
        outcomes: [
          'Organizar melhor os fluxos da clínica',
          'Aumentar a conversão do atendimento',
          'Entender melhor faturamento e retenção',
        ],
        syllabus: [
          'Fluxos de atendimento e oportunidades de melhoria',
          'Gestão de agenda e produtividade',
          'Faturamento e protocolos de cobrança',
          'Experiência do cliente e retenção',
          'Estratégia para crescimento da clínica',
        ],
        bonuses: [
          'Modelo de gestão operacional',
          'Planilha de acompanhamento financeiro',
          'Checklist de atendimento',
          'Materiais de apoio em PDF',
        ],
        audience:
          'Indicado para gestores, donos de clínicas, coordenadores e profissionais que querem otimizar a operação.',
      },
      classes: {
        create: [
          {
            name: 'Turma Outubro 2026',
            code: 'GCL-OUT-2026',
            capacity: 50,
            format: ClassFormat.ONLINE,
            status: 'OPEN',
            notes: 'Turma focada em gestão e operação clínica.',
          },
        ],
      },
    },
  ];

  for (const courseData of courseSeed) {
    await prisma.course.create({
      data: {
        ...courseData,
        instructorId: adminUser.id,
      },
    });
  }

  console.log('Seed concluído: 3 cursos criados com conteúdo inicial para VetEnsino.');
}

main()
  .catch((error) => {
    console.error('Erro no seed do banco:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
