import { PrismaClient, Channel, ContactStatus, DealStatus, MessageSender } from '@prisma/client';
import bcrypt from 'bcryptjs';

export async function seedDatabase(prismaClient: PrismaClient) {
  console.log('Seeding database...');

  // Create default customer (tenant)
  const customer = await prismaClient.customer.upsert({
    where: { slug: 'connectverse' },
    update: {},
    create: {
      name: 'ConnectVerse Inc.',
      slug: 'connectverse',
    },
  });
  console.log('Created customer (tenant):', customer.name);

  // Create default admin user (belongs to the customer)
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prismaClient.user.upsert({
    where: { email: 'alex.green@example.com' },
    update: { customerId: customer.id, role: 'admin' },
    create: {
      email: 'alex.green@example.com',
      password: hashedPassword,
      name: 'Alex Green',
      avatarUrl: 'https://picsum.photos/seed/user/100/100',
      customerId: customer.id,
      role: 'admin',
    },
  });
  console.log('Created admin user:', user.email);

  // Create commercial user
  const commercialUser = await prismaClient.user.upsert({
    where: { email: 'sarah.commercial@example.com' },
    update: { customerId: customer.id, role: 'commercial' },
    create: {
      email: 'sarah.commercial@example.com',
      password: hashedPassword,
      name: 'Sarah Commercial',
      avatarUrl: 'https://picsum.photos/seed/commercial/100/100',
      customerId: customer.id,
      role: 'commercial',
    },
  });
  console.log('Created commercial user:', commercialUser.email);

  // Contact data (previously Customer data)
  const contactsData: {
    name: string;
    email: string;
    phone: string;
    channel: Channel;
    status: ContactStatus;
    tags: string[];
    dealName: string;
    dealAmount: number;
  }[] = [
    { name: 'Sarah Johnson', email: 'sarah.j@example.com', phone: '+1-555-0101', channel: 'whatsapp', status: 'new', tags: ['priority'], dealName: 'Q3 Enterprise Plan', dealAmount: 25000 },
    { name: 'Michael Chen', email: 'm.chen@example.com', phone: '+1-555-0102', channel: 'messenger', status: 'contacted', tags: ['interested'], dealName: 'Startup Package', dealAmount: 2000 },
    { name: 'Emily Rodriguez', email: 'emily.r@example.com', phone: '+1-555-0103', channel: 'instagram', status: 'qualified', tags: ['follow_up'], dealName: 'Social Media Pro', dealAmount: 3500 },
    { name: 'David Lee', email: 'david.lee@example.com', phone: '+1-555-0104', channel: 'tiktok', status: 'demo', tags: [], dealName: 'Influencer Campaign', dealAmount: 10000 },
    { name: 'Jessica Williams', email: 'jess.w@example.com', phone: '+1-555-0105', channel: 'whatsapp', status: 'new', tags: ['new_lead'], dealName: 'Small Business Bundle', dealAmount: 1500 },
    { name: 'James Brown', email: 'james.b@example.com', phone: '+1-555-0106', channel: 'messenger', status: 'new', tags: [], dealName: 'E-commerce Integration', dealAmount: 5000 },
    { name: 'Mary Miller', email: 'mary.m@example.com', phone: '+1-555-0107', channel: 'instagram', status: 'contacted', tags: ['priority'], dealName: 'Content Strategy', dealAmount: 7500 },
    { name: 'John Davis', email: 'john.d@example.com', phone: '+1-555-0108', channel: 'tiktok', status: 'qualified', tags: [], dealName: 'Viral Video Project', dealAmount: 12000 },
    { name: 'Patricia Garcia', email: 'patricia.g@example.com', phone: '+1-555-0109', channel: 'whatsapp', status: 'demo', tags: ['follow_up'], dealName: 'API Integration', dealAmount: 8000 },
    { name: 'Robert Wilson', email: 'robert.w@example.com', phone: '+1-555-0110', channel: 'messenger', status: 'new', tags: ['interested'], dealName: 'Chatbot Setup', dealAmount: 3000 },
    { name: 'Jennifer Martinez', email: 'jennifer.m@example.com', phone: '+1-555-0111', channel: 'instagram', status: 'unqualified', tags: [], dealName: 'Growth Hacking Consult', dealAmount: 1000 },
    { name: 'Linda Anderson', email: 'linda.a@example.com', phone: '+1-555-0112', channel: 'tiktok', status: 'new', tags: [], dealName: 'Ad Campaign', dealAmount: 15000 },
    { name: 'William Thomas', email: 'william.t@example.com', phone: '+1-555-0113', channel: 'whatsapp', status: 'contacted', tags: ['priority'], dealName: 'Support Automation', dealAmount: 4500 },
    { name: 'Elizabeth Taylor', email: 'elizabeth.t@example.com', phone: '+1-555-0114', channel: 'messenger', status: 'qualified', tags: [], dealName: 'Community Management', dealAmount: 6000 },
    { name: 'Richard Moore', email: 'richard.m@example.com', phone: '+1-555-0115', channel: 'instagram', status: 'demo', tags: ['follow_up', 'interested'], dealName: 'Brand Partnership', dealAmount: 20000 },
    { name: 'Susan Jackson', email: 'susan.j@example.com', phone: '+1-555-0116', channel: 'tiktok', status: 'new', tags: [], dealName: 'Creator Collab', dealAmount: 9000 },
    { name: 'Joseph White', email: 'joseph.w@example.com', phone: '+1-555-0117', channel: 'whatsapp', status: 'contacted', tags: ['new_lead'], dealName: 'Business Account Setup', dealAmount: 2500 },
    { name: 'Karen Martinez', email: 'karen.m@example.com', phone: '+1-555-0122', channel: 'messenger', status: 'qualified', tags: [], dealName: 'Lead Gen Funnel', dealAmount: 8500 },
    { name: 'Christopher Robinson', email: 'christopher.r@example.com', phone: '+1-555-0123', channel: 'instagram', status: 'demo', tags: ['follow_up'], dealName: 'IG Automation', dealAmount: 5500 },
    { name: 'Nancy Clark', email: 'nancy.c@example.com', phone: '+1-555-0124', channel: 'tiktok', status: 'won', tags: [], dealName: 'Video Marketing', dealAmount: 11000 },
  ];

  // Create contacts with tags, deals, and conversations
  for (let i = 0; i < contactsData.length; i++) {
    const data = contactsData[i];
    const joined = new Date();
    joined.setDate(joined.getDate() - Math.floor(Math.random() * 180)); // Random date in last 6 months

    const contact = await prismaClient.contact.upsert({
      where: { customerId_email: { customerId: customer.id, email: data.email } },
      update: {},
      create: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        avatarUrl: `https://picsum.photos/seed/${100 + i}/100/100`,
        channel: data.channel,
        status: data.status,
        dealName: data.dealName,
        joined,
        customerId: customer.id,
      },
    });

    // Create tags
    for (const tag of data.tags) {
      await prismaClient.contactTag.upsert({
        where: { contactId_name: { contactId: contact.id, name: tag } },
        update: {},
        create: {
          name: tag,
          contactId: contact.id,
        },
      });
    }

    // Create deal
    const dealStatus: DealStatus = data.status === 'won' ? 'Won' : data.status === 'unqualified' ? 'Lost' : 'InProgress';
    await prismaClient.deal.create({
      data: {
        name: data.dealName,
        amount: data.dealAmount,
        status: dealStatus,
        contactId: contact.id,
        closeDate: new Date(),
      },
    });

    // Create conversation with messages
    const conversation = await prismaClient.conversation.create({
      data: {
        channel: data.channel,
        contactId: contact.id,
        customerId: customer.id,
        unreadCount: Math.random() > 0.7 ? Math.floor(Math.random() * 3) + 1 : 0,
      },
    });

    // Add sample messages
    const now = new Date();
    const messages: { text: string; sender: MessageSender; minutesAgo: number }[] = [
      { text: `Hi, I'm interested in ${data.dealName}`, sender: 'contact', minutesAgo: 60 },
      { text: 'Hello! Thanks for reaching out. How can I help you today?', sender: 'user', minutesAgo: 55 },
      { text: 'I wanted to know more about the pricing and features.', sender: 'contact', minutesAgo: 50 },
      { text: "I'd be happy to explain! Let me send you our detailed information.", sender: 'user', minutesAgo: 45 },
    ];

    for (const msg of messages) {
      const timestamp = new Date(now.getTime() - msg.minutesAgo * 60000);
      await prismaClient.message.create({
        data: {
          text: msg.text,
          sender: msg.sender,
          timestamp,
          conversationId: conversation.id,
          userId: msg.sender === 'user' ? user.id : null,
        },
      });
    }
  }
  console.log(`Created ${contactsData.length} contacts with deals and conversations`);

  // Create integrations (scoped to customer)
  const integrations = [
    { name: 'Facebook Messenger', channel: 'messenger' as Channel, description: 'Integrate Facebook Messenger to respond to customers from your Facebook page.', status: 'connected' as const },
    { name: 'Instagram Direct', channel: 'instagram' as Channel, description: 'Connect Instagram Direct messages for seamless customer communication.', status: 'disconnected' as const },
    { name: 'TikTok Messages', channel: 'tiktok' as Channel, description: 'Manage TikTok messages and engage with your audience.', status: 'disconnected' as const },
  ];

  for (const integration of integrations) {
    const existing = await prismaClient.integration.findFirst({
      where: { customerId: customer.id, channel: integration.channel },
    });
    if (!existing) {
      await prismaClient.integration.create({
        data: {
          ...integration,
          customerId: customer.id,
        },
      });
    }
  }

  // Create a WhatsApp integration for the commercial user (disconnected)
  const existingWaIntegration = await prismaClient.integration.findFirst({
    where: { customerId: customer.id, channel: 'whatsapp', userId: commercialUser.id },
  });
  if (!existingWaIntegration) {
    await prismaClient.integration.create({
      data: {
        name: `WhatsApp - ${commercialUser.name}`,
        channel: 'whatsapp',
        description: 'WhatsApp Business via QR code connection.',
        status: 'disconnected',
        customerId: customer.id,
        userId: commercialUser.id,
      },
    });
  }
  console.log('Created integrations');

  // Create business info (scoped to customer)
  await prismaClient.businessInfo.upsert({
    where: { customerId: customer.id },
    update: {},
    create: {
      customerId: customer.id,
      companyName: 'ConnectVerse Inc.',
      address: '123 Main Street, Anytown, USA 12345',
      phone: '+1 (555) 123-4567',
      email: 'contact@connectverse.com',
    },
  });
  console.log('Created business info');

  // Create service statuses (global, not tenant-scoped)
  const services = [
    { name: 'API Server', status: 'operational' as const },
    { name: 'Database', status: 'operational' as const },
    { name: 'WhatsApp Integration', status: 'operational' as const },
    { name: 'Messenger Integration', status: 'operational' as const },
    { name: 'Instagram Integration', status: 'degraded' as const },
    { name: 'TikTok Integration', status: 'operational' as const },
    { name: 'Email Service', status: 'operational' as const },
  ];

  for (const service of services) {
    await prismaClient.serviceStatus.upsert({
      where: { name: service.name },
      update: { status: service.status, lastChecked: new Date() },
      create: { name: service.name, status: service.status },
    });
  }
  console.log('Created service statuses');

  // Create update logs (global, not tenant-scoped)
  const updateLogs = [
    {
      version: '1.2.0',
      date: new Date('2024-01-15'),
      description: 'New TikTok integration and performance improvements',
      changes: ['Added TikTok messaging support', 'Improved conversation loading speed by 40%', 'Fixed notification delivery issues'],
    },
    {
      version: '1.1.0',
      date: new Date('2024-01-01'),
      description: 'Enhanced dashboard and customer management',
      changes: ['New dashboard analytics widgets', 'Customer funnel tracking', 'Bulk customer operations', 'Dark mode support'],
    },
    {
      version: '1.0.0',
      date: new Date('2023-12-15'),
      description: 'Initial release of ConnectVerse',
      changes: ['Unified inbox for WhatsApp, Messenger, Instagram', 'Customer profiles and management', 'Basic analytics dashboard'],
    },
  ];

  for (const log of updateLogs) {
    const existingLog = await prismaClient.updateLog.findFirst({
      where: { version: log.version },
    });

    if (!existingLog) {
      const createdLog = await prismaClient.updateLog.create({
        data: {
          version: log.version,
          date: log.date,
          description: log.description,
        },
      });

      for (const change of log.changes) {
        await prismaClient.updateLogChange.create({
          data: {
            change,
            updateLogId: createdLog.id,
          },
        });
      }
    }
  }
  console.log('Created update logs');

  // Create FAQs (global, not tenant-scoped)
  const faqs = [
    { question: 'How do I connect my WhatsApp Business account?', answer: 'Go to Integrations, click on WhatsApp Business, and follow the setup wizard. You will need your WhatsApp Business API credentials.' },
    { question: 'Can I manage multiple team members?', answer: 'Yes! ConnectVerse supports team collaboration. Go to Settings > Team to invite members and manage permissions.' },
    { question: 'How does the unified inbox work?', answer: 'The unified inbox aggregates messages from all connected channels (WhatsApp, Messenger, Instagram, TikTok) into a single view, making it easy to respond to customers.' },
    { question: 'What analytics are available?', answer: 'The dashboard shows conversation trends, platform performance, response rates, and deal pipeline metrics. You can also export reports.' },
    { question: 'How do I track customer deals?', answer: 'Each customer profile includes a deal history section. You can create new deals, update their status, and track them through your sales funnel.' },
    { question: 'Is there a mobile app?', answer: 'We are currently working on mobile apps for iOS and Android. Sign up for our newsletter to be notified when they launch!' },
  ];

  for (let i = 0; i < faqs.length; i++) {
    const existingFaq = await prismaClient.faqItem.findFirst({
      where: { question: faqs[i].question },
    });

    if (!existingFaq) {
      await prismaClient.faqItem.create({
        data: {
          question: faqs[i].question,
          answer: faqs[i].answer,
          order: i,
        },
      });
    }
  }
  console.log('Created FAQs');

  // Create sample emails (scoped to customer)
  const emails = [
    {
      fromName: 'TechCrunch',
      fromEmail: 'updates@techcrunch.com',
      fromAvatar: 'https://picsum.photos/seed/301/100/100',
      subject: 'Latest in AI and Startups',
      body: '<p>Hello Alex,</p><p>Here are the top stories from TechCrunch this week. AI is taking over, startups are booming, and we have the inside scoop...</p>',
      isRead: false,
      folder: 'inbox' as const,
    },
    {
      fromName: 'Sarah Johnson',
      fromEmail: 'sarah.j@example.com',
      fromAvatar: 'https://picsum.photos/seed/101/100/100',
      subject: 'Re: Quick Question',
      body: '<p>Hi Alex,</p><p>Just following up on our conversation from yesterday. Do you have any updates?</p><p>Best,<br/>Sarah</p>',
      isRead: true,
      folder: 'inbox' as const,
    },
    {
      fromName: 'Design Weekly',
      fromEmail: 'newsletter@designweekly.co',
      fromAvatar: 'https://picsum.photos/seed/302/100/100',
      subject: 'Your weekly dose of design inspiration',
      body: '<p>This week, we are looking at the latest trends in neumorphism and how to apply them to your projects...</p>',
      isRead: true,
      folder: 'inbox' as const,
    },
    {
      fromName: user.name,
      fromEmail: user.email,
      fromAvatar: user.avatarUrl,
      subject: 'Meeting Notes from today',
      body: '<p>Hi Team,</p><p>Here are the notes from our meeting this morning. Please review and add any action items I might have missed.</p>',
      isRead: true,
      folder: 'sent' as const,
    },
  ];

  for (const email of emails) {
    const existingEmail = await prismaClient.email.findFirst({
      where: { subject: email.subject, fromEmail: email.fromEmail, customerId: customer.id },
    });

    if (!existingEmail) {
      await prismaClient.email.create({
        data: {
          ...email,
          userId: email.folder === 'sent' ? user.id : null,
          customerId: customer.id,
        },
      });
    }
  }
  console.log('Created sample emails');

  console.log('Seeding completed!');
}
