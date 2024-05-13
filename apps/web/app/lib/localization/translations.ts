import { Locale } from './localization';

const en = {
  'main.reserve': 'Learn More',
  'main.read_bible': 'Read in Context',
  'main.time_left': 'See you in {{days}} days',
  'main.gyc_tagline':
    'GYC Canada is a {{movement}} of young people {{for}} young people.',
  'main.gyc_tagline.movement': 'movement',
  'main.gyc_tagline.for': 'for',
  'main.read_our_story': 'Read our story',
  'main.meet_the_team': 'Meet the team',
  'main.newsletter.title': 'Stay in the loop',
  'main.newsletter.subtitle':
    'We’ll send our monthly newsletter straight to your inbox, give you a chance for early-bird pricing the moment it launches, and more!',
  'main.newsletter.name.label': 'Full Name',
  'main.newsletter.name.placeholder': 'Full Name',
  'main.newsletter.email.label': 'Email',
  'main.newsletter.email.placeholder': 'Email',
  'main.newsletter.submit': 'Sign up',
  'main.newsletter.error':
    'An error occurred while signing you up. Please try again later.',
  'main.newsletter.success': 'You have been signed up successfully!',
  'main.socials.title':
    'Don’t forget to follow us on social media to get to know our team and stay even more up-to-date!',
  'main.join.title': 'Join the Movement',
  'main.join.subtitle':
    'GYC Canada is a non-profit organization run by a handful of amazing volunteers.{{br}}That means we depend entirely on your attendance and donations to keep the movement pushing forward.',
  'main.donate.link': 'Consider donating',
  'main.join.link': 'Volunteer',

  'nav.home': '{{year}} Conference',
  'nav.about': 'Our Story',
  'nav.team': 'Meet the Team',
  'nav.contact': 'Get in Touch',
  'nav.give': 'Give to the Mission',
  'nav.volunteer': 'Join the Movement',
  'footer.copy': `© ${new Date().getFullYear()} GYC Canada. All rights reserved.`,
  'footer.affiliation': 'A {{gyc}} affiliate ministry.',
  'footer.links': 'Quick Links',
  'contact.title': 'Want to get in touch?',
  'contact.directions':
    'You can reach us anytime via email at {{email}}, or with the form below.',
  'contact.form.name': 'Name',
  'contact.form.name.placeholder': 'Type your full name here',
  'contact.form.name.required': 'Please enter your name',
  'contact.form.name.error': 'Please enter your name',
  'contact.form.contact-method': 'Preferred contact method',
  'contact.form.contact-method.email': 'Email',
  'contact.form.contact-method.phone': 'Phone',
  'contact.form.contact-method.both': 'Both',
  'contact.form.contact-method.required': 'Please select a contact method',
  'contact.form.email': 'What is your email address?',
  'contact.form.email.placeholder': 'example@mail.com',
  'contact.form.email.required': 'Please enter your email address',
  'contact.form.email.error': 'Please enter a valid email address',
  'contact.form.phone': 'What is your phone number?',
  'contact.form.phone.placeholder': '123-456-7890',
  'contact.form.phone.required': 'Please enter your phone number',
  'contact.form.message': 'What can we help you with?',
  'contact.form.message.placeholder': 'Type your message here...',
  'contact.form.message.required': 'Please enter your message',
  'contact.form.submit': 'Send it',
  'contact.form.error':
    'An error occurred while sending your message. Please try again later.',
  'give.title': 'Support the {{movement}}.',
  'give.movement': 'movement',
  'give.reason':
    'Our call to mission, is to be the light of the world. Not a light hidden in the corner, covered by the humdrum of life, but in the open, where all can see. GYC Canada wants to magnify that light, to bring it to all of Canada.',
  'give.directions': "Here's how you can give:",
  'give.directions.1': "Enter the amount you'd like to give.",
  'give.directions.2': 'Choose your preferred payment method.',
  'give.directions.3':
    'Tap on "Make this a monthly donation" if you want to give monthly.',
  'give.directions.4':
    'If there\'s a specific purpose for your gift, let us know in the "Add a note" section.',
  'give.contine': 'Continue',
  'team.title': 'The people behind the {{movement}}.',
  'team.title.movement': 'movement',
  'team.image.alt': 'A group of young people smiling and standing together.',
  'team.logo.alt': 'GYC Canada Logo',
  'team.subtitle':
    'We are GYC Canada. Young people dedicated to spreading the Gospel, and living the lives that God has planned for us. We are fulfilling his purpose for us, ambassadors to the world. We go boldly where Christ leads.',
  'team.board': 'Board of Directors',
  'team.position.president': 'President',
  'team.position.vice-president': 'Vice President',
  'team.position.vp-logistics': 'VP of Logistics',
  'team.position.vp-communications': 'VP of Communications',
  'team.position.vp-networking': 'VP of Networking',
  'team.position.vp-missions': 'VP of Missions',
  'team.position.secretary': 'Secretary',
  'team.position.treasurer': 'Treasurer',
  'volunteer.title': 'Become a part of the {{movement}}.',
  'volunteer.title.movement': 'movement',
  'volunteer.subtitle':
    'Join a group of young people, young professionals, and laypersons who are dedicated, passionate, and focused. As a youth-led organization, we are mobilizing in our movement to share Christ with Canada.',
  'volunteer.directions': 'Select the area you are interested in:',
  'volunteer.form.name.label': 'What is your name?',
  'volunteer.form.name.placeholder': 'Type your full name here',
  'volunteer.form.name.required': 'Please enter your name',
  'volunteer.form.method.label': 'Do you prefer phone or email?',
  'volunteer.form.method.email': 'Email',
  'volunteer.form.method.phone': 'Phone',
  'volunteer.form.method.both': 'Both',
  'volunteer.form.method.required': 'Please select a contact method',
  'volunteer.form.email.label': 'What is your email address?',
  'volunteer.form.email.placeholder': 'example@mail.com',
  'volunteer.form.email.required': 'Please enter your email address',
  'volunteer.form.email.error': 'Please enter a valid email address',
  'volunteer.form.phone.label': 'What is your phone number?',
  'volunteer.form.phone.placeholder': '123-456-7890',
  'volunteer.form.phone.required': 'Please enter your phone number',
  'volunteer.form.age.label': 'How old are you?',
  'volunteer.form.age.placeholder': 'Enter your age here',
  'volunteer.form.age.required': 'Please enter your age',
  'volunteer.form.location.label': 'Where are you located?',
  'volunteer.form.location.placeholder': 'Enter your location here',
  'volunteer.form.location.required': 'Please enter your location',
  'volunteer.form.background.label': 'What is your background?',
  'volunteer.form.background.placeholder': 'Enter your background here',
  'volunteer.form.background.required': 'Please enter your background',
  'volunteer.form.why.label': 'Why do you want to volunteer with us?',
  'volunteer.form.why.placeholder': 'Enter your reason here',
  'volunteer.form.why.required': 'Please enter your reason',
  'volunteer.form.submit': 'Submit',
  'volunteer.form.error':
    'An error occurred while sending your message. Please try again later.',
  'registration.watch-promo': 'Watch promo',
  'registration.register': 'Register',
  'registration.speakers.title': 'Speakers',
  'registration.seminars.title': 'Seminars',
  'registration.faq.title': 'Got Questions?',
  'registration.faq.subtitle':
    'More detailed conference information won’t be available until registration opens. You may also contact us if you need to get in touch, or check our FAQ for quick answers.',
  'registration.faq.contact': 'Get in touch',
  'registration.faq.view': 'View FAQ',
  'registration.register.title': 'Register now with early-bird rates!',
  'registration.register.subtitle':
    'See you on August 21 at the Rutland SDA church in Kelowna, British Columbia. Sign up before June 22nd to secure earlybird pricing.',
  'registration.register.button': 'Register Now',
  'about.title': 'Our Story',
  'about.1': `GYC Canada (Generation Youth Christ) is a youth-initiated and led
        movement of Seventh-day Adventists from diverse, united in a common
        commitment to serious Bible study, intense prayer, uncompromising
        lifestyle, and boldness in sharing Christ with others.`,
  'about.2': `GYC Canada seeks to uphold the distinctive message of the Seventh-day
        Adventist Church and equip and inspire young Adventists to be Christian
        ambassadors to their respective places of work and study.`,
  'about.3': `GYC Canada is the Canadian affiliate of GYC. We are Canadian Seventh-day
        Adventist young people who seek to promote the spirit and ideals of GYC
        in Canada.`,
  'about.4': `GYC Canada is a recognized independent supporting ministry of the
        Seventh-day Adventist Church of Canada. GYC Canada supports the
        Seventh-day Adventist Church and encourages young people across Canada
        to be active members in their local churches.`,
  'about.disclaimer': `Disclaimer: GYC Canada does not accept tithes. We encourage donors to
        give tithes to their respective churches.`,
  'about.quote.1': `“Let no one despise you for your youth, but set the believers an
          example in speech, in conduct, in love, in faith, in purity.” {{verse}}`,
  'about.quote.1.verse': '1 Timothy 4:12',
  'about.quote.2': `“With such an army of workers as our youth, rightly trained, might
          furnish, how soon the message of a crucified, risen, and soon-coming
          Saviour might be carried to the whole world!” {{source}}`,
  'about.quote.2.source': 'Education, p. 271.2',
} as const;

export type TranslationKey = keyof typeof en;

const fr: Record<TranslationKey, string> = {
  'main.reserve': 'En savoir plus',
  'main.read_bible': 'Lire en contexte',

  'main.time_left': 'Rendez-vous dans {{days}} jours',

  'main.gyc_tagline':
    'GYC Canada est un {{movement}} de jeunes {{for}} les jeunes.',
  'main.gyc_tagline.movement': 'mouvement',
  'main.gyc_tagline.for': 'pour',
  'main.read_our_story': 'Lire notre histoire',
  'main.meet_the_team': 'Rencontrez l’équipe',
  'main.newsletter.title': 'Inscrivez-vous à notre bulletin d’information',
  'main.newsletter.subtitle':
    'Nous enverrons notre bulletin mensuel directement dans votre boîte de réception, vous donnant la chance de profiter des tarifs de lancement dès leur lancement, et plus encore!',
  'main.newsletter.name.label': 'Nom complet',
  'main.newsletter.name.placeholder': 'Nom complet',
  'main.newsletter.email.placeholder': 'Courriel',
  'main.newsletter.email.label': 'Courriel',
  'main.newsletter.submit': "S'inscrire",
  'main.newsletter.error':
    "Une erreur s'est produite lors de votre inscription. Veuillez réessayer plus tard.",
  'main.newsletter.success': 'Vous avez été inscrit avec succès!',
  'main.socials.title':
    'N’oubliez pas de nous suivre sur les réseaux sociaux pour mieux connaître notre équipe et rester encore plus à jour!',
  'main.join.title': 'Rejoignez le mouvement',
  'main.join.subtitle':
    'GYC Canada est une organisation à but non lucratif dirigée par une poignée de bénévoles incroyables.{{br}}Cela signifie que nous dépendons entièrement de votre présence et de vos dons pour faire avancer le mouvement.',
  'main.donate.link': 'Considérez un don',
  'main.join.link': 'Faire du bénévolat',
  'nav.home': 'Conférence {{year}}',
  'nav.about': 'Notre histoire',
  'nav.team': 'Rencontrez l’équipe',
  'nav.contact': 'Entrer en contact',
  'nav.give': 'Donnez à la mission',
  'nav.volunteer': 'Rejoignez le mouvement',
  'footer.copy': `© ${new Date().getFullYear()} GYC Canada. Tous droits réservés.`,
  'footer.affiliation': 'Un ministère affilié à {{gyc}}.',
  'footer.links': 'Liens rapides',
  'contact.title': 'Vous voulez entrer en contact?',
  'contact.directions':
    'Vous pouvez nous joindre à tout moment par courriel à {{email}}, ou avec le formulaire ci-dessous.',
  'contact.form.name': 'Nom',
  'contact.form.name.placeholder': 'Entrez votre nom complet ici',
  'contact.form.name.required': 'Veuillez entrer votre nom',
  'contact.form.name.error': 'Veuillez entrer votre nom',
  'contact.form.contact-method': 'Méthode de contact préférée',
  'contact.form.contact-method.email': 'Courriel',
  'contact.form.contact-method.phone': 'Téléphone',
  'contact.form.contact-method.both': 'Les deux',
  'contact.form.contact-method.required':
    'Veuillez sélectionner une méthode de contact',
  'contact.form.email': 'Quelle est votre adresse courriel?',
  'contact.form.email.placeholder': 'example@mail.com',
  'contact.form.email.required': 'Veuillez entrer votre adresse courriel',
  'contact.form.email.error': 'Veuillez entrer une adresse courriel valide',
  'contact.form.phone': 'Quel est votre numéro de téléphone?',
  'contact.form.phone.placeholder': '123-456-7890',
  'contact.form.phone.required': 'Veuillez entrer votre numéro de téléphone',
  'contact.form.message': 'Comment pouvons-nous vous aider?',
  'contact.form.message.placeholder': 'Entrez votre message ici...',
  'contact.form.message.required': 'Veuillez entrer votre message',
  'contact.form.submit': 'Envoyer',
  'contact.form.error':
    "Une erreur s'est produite lors de l'envoi de votre message. Veuillez réessayer plus tard.",
  'give.title': 'Soutenez le {{movement}}.',
  'give.movement': 'mouvement',
  'give.reason':
    "Notre appel à la mission est d'être la lumière du monde. Pas une lumière cachée dans un coin, couverte par la routine de la vie, mais à découvert, où tout le monde peut la voir. GYC Canada veut magnifier cette lumière, la porter à tout le Canada.",
  'give.directions': 'Voici comment vous pouvez donner :',
  'give.directions.1': 'Entrez le montant que vous souhaitez donner.',
  'give.directions.2': 'Choisissez votre mode de paiement préféré.',
  'give.directions.3':
    'Cliquez sur "Faire un don mensuel" si vous souhaitez donner mensuellement.',
  'give.directions.4':
    'Si votre don a un but spécifique, veuillez nous en informer dans la section "Ajouter une note".',
  'give.contine': 'Continuer',
  'team.title': 'Les personnes derrière le {{movement}}.',
  'team.title.movement': 'mouvement',
  'team.image.alt': 'Un groupe de jeunes souriants et debout ensemble.',
  'team.logo.alt': 'Logo GYC Canada',
  'team.subtitle':
    "Nous sommes GYC Canada. Des jeunes dédiés à la diffusion de l'Évangile et à vivre les vies que Dieu a prévues pour nous. Nous accomplissons son dessein pour nous, ambassadeurs dans le monde. Nous allons hardiment là où Christ nous conduit.",
  'team.board': 'Conseil d’administration',
  'team.position.president': 'Président',
  'team.position.vice-president': 'Vice-président',
  'team.position.vp-logistics': 'VP de la logistique',
  'team.position.vp-communications': 'VP des communications',
  'team.position.vp-networking': 'VP du réseautage',
  'team.position.vp-missions': 'VP des missions',
  'team.position.secretary': 'Secrétaire',
  'team.position.treasurer': 'Trésorier',
  'volunteer.title': 'Faites partie du {{movement}}.',
  'volunteer.title.movement': 'mouvement',
  'volunteer.subtitle':
    'Rejoignez un groupe de jeunes, de jeunes professionnels et de laïcs dédiés, passionnés et concentrés. En tant qu’organisation dirigée par des jeunes, nous nous mobilisons dans notre mouvement pour partager le Christ avec le Canada.',
  'volunteer.directions': 'Sélectionnez le domaine qui vous intéresse :',
  'volunteer.form.name.label': 'Quel est votre nom?',
  'volunteer.form.name.placeholder': 'Entrez votre nom complet ici',
  'volunteer.form.name.required': 'Veuillez entrer votre nom',
  'volunteer.form.method.label': 'Préférez-vous le téléphone ou le courriel?',
  'volunteer.form.method.email': 'Courriel',
  'volunteer.form.method.phone': 'Téléphone',
  'volunteer.form.method.both': 'Les deux',
  'volunteer.form.method.required':
    'Veuillez sélectionner une méthode de contact',
  'volunteer.form.email.label': 'Quelle est votre adresse courriel?',
  'volunteer.form.email.placeholder': 'example@mail.com',
  'volunteer.form.email.required': 'Veuillez entrer votre adresse courriel',
  'volunteer.form.email.error': 'Veuillez entrer une adresse courriel valide',
  'volunteer.form.phone.label': 'Quel est votre numéro de téléphone?',
  'volunteer.form.phone.placeholder': '123-456-7890',
  'volunteer.form.phone.required': 'Veuillez entrer votre numéro de téléphone',
  'volunteer.form.age.label': 'Quel âge avez-vous?',
  'volunteer.form.age.placeholder': 'Entrez votre âge ici',
  'volunteer.form.age.required': 'Veuillez entrer votre âge',
  'volunteer.form.location.label': 'Où êtes-vous situé?',
  'volunteer.form.location.placeholder': 'Entrez votre emplacement ici',
  'volunteer.form.location.required': 'Veuillez entrer votre emplacement',
  'volunteer.form.background.label': 'Quel est votre parcours?',
  'volunteer.form.background.placeholder': 'Entrez votre parcours ici',
  'volunteer.form.background.required': 'Veuillez entrer votre parcours',
  'volunteer.form.why.label':
    'Pourquoi voulez-vous faire du bénévolat avec nous?',
  'volunteer.form.why.placeholder': 'Entrez votre raison ici',
  'volunteer.form.why.required': 'Veuillez entrer votre raison',
  'volunteer.form.submit': 'Soumettre',
  'volunteer.form.error':
    "Une erreur s'est produite lors de l'envoi de votre message. Veuillez réessayer plus tard.",
  'registration.watch-promo': 'Regardez la promo',
  'registration.register': 'Inscrivez-vous',
  'registration.speakers.title': 'Conférenciers',
  'registration.seminars.title': 'Séminaires',
  'registration.faq.title': 'Des questions?',
  'registration.faq.subtitle':
    "Des informations plus détaillées sur la conférence ne seront pas disponibles avant l'ouverture des inscriptions. Vous pouvez également nous contacter si vous avez besoin de nous joindre, ou consulter notre FAQ pour des réponses rapides.",
  'registration.faq.contact': 'Entrer en contact',
  'registration.faq.view': 'Voir FAQ',
  'registration.register.title':
    'Inscrivez-vous dès maintenant avec des tarifs de lancement!',
  'registration.register.subtitle':
    'Rendez-vous le 21 août à l’église adventiste de Rutland à Kelowna, en Colombie-Britannique. Inscrivez-vous avant le 22 juin pour bénéficier des tarifs de lancement.',
  'registration.register.button': "S'inscrire",

  'about.title': 'Notre histoire',
  'about.1': `GYC Canada (Generation Youth Christ) est un mouvement de jeunes
        adventistes du septième jour, diversifiés, unis dans un engagement
        commun envers une étude sérieuse de la Bible, une prière intense, un
        style de vie sans compromis et une audace à partager le Christ avec
        les autres.`,
  'about.2': `GYC Canada cherche à défendre le message distinctif de l'Église
        adventiste du septième jour et à équiper et inspirer les jeunes
        adventistes à être des ambassadeurs chrétiens dans leurs lieux de
        travail et d'études respectifs.`,
  'about.3': `GYC Canada est l'affilié canadien de GYC. Nous sommes des jeunes
        adventistes du septième jour canadiens qui cherchent à promouvoir
        l'esprit et les idéaux de GYC au Canada.`,
  'about.4': `GYC Canada est un ministère de soutien indépendant reconnu de
        l'Église adventiste du septième jour du Canada. GYC Canada soutient
        l'Église adventiste du septième jour et encourage les jeunes du
        Canada à être des membres actifs de leurs églises locales.`,
  'about.disclaimer': `Avis de non-responsabilité : GYC Canada n'accepte pas les dîmes.
        Nous encourageons les donateurs à donner les dîmes à leurs églises
        respectives.`,
  'about.quote.1': `“Que personne ne méprise ta jeunesse, mais sois un modèle pour les
          croyants en parole, en conduite, en amour, en foi et en pureté.” {{verse}}`,
  'about.quote.1.verse': '1 Timothée 4:12',
  'about.quote.2': `“Avec une telle armée de travailleurs que notre jeunesse, correctement
          formée, pourrait fournir, comment le message d'un Sauveur crucifié,
          ressuscité et bientôt à venir pourrait-il être porté à tout le monde!” {{source}}`,
  'about.quote.2.source': 'Éducation, p. 271.2',
};

export const root = {
  en,
  fr,
} as const satisfies Record<Locale, Record<TranslationKey, string>>;
