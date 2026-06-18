import type { Locale } from './localization';

const en = {
  'main.reserve': 'Learn More',
  'main.read_bible': 'Read in Context',
  'main.time_left': 'See you in {{days}} days',
  'main.meet_the_team': 'Meet the team',
  'main.newsletter.name.label': 'Full Name',
  'main.newsletter.name.placeholder': 'Full Name',
  'main.newsletter.email.label': 'Email',
  'main.newsletter.email.placeholder': 'Email',
  'main.newsletter.email.error': 'Please enter a valid email address.',
  'main.newsletter.name.required': 'Please enter your name.',
  'main.newsletter.submit': 'Sign up',
  'main.newsletter.error':
    'An error occurred while signing you up. Please try again later.',
  'main.newsletter.success.description':
    'You have been signed up successfully!',
  'main.newsletter.success.title': 'Thank you for signing up!',

  'nav.home': '{{year}} Conference',
  'nav.about': 'About us',
  'nav.team': 'Meet the Team',
  'nav.contact': 'Get in Touch',
  'nav.give': 'Support the Movement',
  'nav.volunteer': 'Become a volunteer',
  'nav.faq': 'FAQ',
  'footer.copy': `© ${new Date().getFullYear()} GYC Canada. All rights reserved.`,
  'footer.affiliation': 'A {{gyc}} affiliate ministry.',
  'footer.links': 'Quick Links',
  'contact.form.name': 'What is your name?',
  'contact.form.name.placeholder': 'Type your full name here',
  'contact.form.name.required': 'Please enter your name',
  'contact.form.name.error': 'Please enter your name',
  'contact.form.contact-method': 'Preferred contact method:',
  'contact.form.contact-method.email': 'Email',
  'contact.form.contact-method.phone': 'Phone',
  'contact.form.contact-method.both': 'Email & Phone',
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
  'contact.form.success.title': 'Thank you for contacting us!',
  'contact.form.success.description':
    'Your message has been sent successfully! We will take notice of it and answer as soon as possible.',
  'give.directions': "Here's how you can give:",
  'give.continue': 'Continue',
  // `team.title` / `team.title.movement` / `team.image.alt` / `team.logo.alt` /
  // `team.subtitle` / `team.board` migrated to the CMS `TeamPage` object (the
  // route renders them from `getPage('team')`). `team.position.*` (the executive
  // roster, still on `site.json` via `getTeam()`) and `nav.team` stay.
  'team.position.president': 'President',
  'team.position.vice-president': 'General Vice President',
  'team.position.vp-logistics': 'VP of Logistics',
  'team.position.vp-communications': 'VP of Communications',
  'team.position.vp-networking': 'VP of Networking',
  'team.position.vp-missions': 'VP of Missions',
  'team.position.secretary': 'Executive Secretary',
  'team.position.treasurer': 'Treasurer',
  'volunteer.form.name.label': 'What is your name?',
  'volunteer.form.name.placeholder': 'Type your full name here',
  'volunteer.form.name.required': 'Please enter your name',
  'volunteer.form.method.label': 'Preferred contact method:',
  'volunteer.form.method.email': 'Email',
  'volunteer.form.method.phone': 'Phone',
  'volunteer.form.method.both': 'Email & Phone',
  'volunteer.form.method.required': 'Please select a contact method',
  'volunteer.form.email.label': 'What is your email address?',
  'volunteer.form.email.placeholder': 'example@mail.com',
  'volunteer.form.email.required': 'Please enter your email address',
  'volunteer.form.email.error': 'Please enter a valid email address',
  'volunteer.form.phone.label': 'What is your phone number?',
  'volunteer.form.phone.placeholder': '123-456-7890',
  'volunteer.form.phone.required': 'Please enter your phone number',
  'volunteer.form.age.label': 'What is your age?',
  'volunteer.form.age.placeholder': 'Enter your age here',
  'volunteer.form.age.required': 'Please enter your age',
  'volunteer.form.location.label': 'Where are you located?',
  'volunteer.form.location.placeholder': 'Enter your location here',
  'volunteer.form.location.required': 'Please enter your location',
  'volunteer.form.background.label':
    'Please tell us more about yourself and your background.',
  'volunteer.form.background.placeholder': 'Enter your background here',
  'volunteer.form.background.required': 'Please enter your background',
  'volunteer.form.why.label': 'What motivates you to volunteer with us?',
  'volunteer.form.why.placeholder': 'Enter your reason here',
  'volunteer.form.why.required': 'Please enter your reason',
  'volunteer.form.submit': 'Submit',
  'volunteer.form.error':
    'An error occurred while sending your message. Please try again later.',
  'volunteer.form.success.description':
    'Your message has been sent successfully!',
  'volunteer.form.success.title': 'Thank you for your interest!',

  'registration.schedule': 'Schedule',
  'registration.watch-promo': 'Watch promo',
  'registration.register': 'Register',
  'registration.speakers.title': 'Speakers',
  'registration.seminars.title': 'Seminars',
  'registration.faq.title': 'Got Questions?',
  'registration.faq.subtitle':
    'More detailed conference information will be available after registration opens. You may also contact us if you need to get in touch, or check our FAQ for quick answers.',
  'registration.faq.contact': 'Get in touch',
  'registration.faq.view': 'View FAQ',
  'registration.register.title': 'Register Now!',
  'registration.register.subtitle':
    'See you on August 21 at the Rutland SDA church in Kelowna, British Columbia. Sign up before June 22nd to secure earlybird pricing.',
  'registration.register.button': 'Register Now',
  'registration.hotels.description':
    "There are quite a few hotels in Kelowna, BC which can make it daunting to find the right one. We've listed the closest hotels to the Venue below. Please keep in mind that you may be able to save a considerable amount of money by getting a room with friends, using Airbnb or by using our {{facebook}}",
  'registration.hotels.description.facebook':
    'Facebook Rides & Roommates Group',
  'registration.form.title': 'Register for GYC Canada {{year}}',
  'registration.form.error':
    'An error occurred while submitting your registration. Please try again later.',
  'registration.form.success.title': 'Thank you for registering!',
  'registration.form.success.description':
    'Your registration has been received. We will be in touch with more details soon.',
  'registration.form.attendee': 'Attendee',
  'registration.form.exhibitor': 'Exhibitor',
  'registration.form.type.required':
    'Please select whether you are registering as an attendee or exhibitor',
  'registration.form.name.label': 'Full Name',
  'registration.form.name.placeholder': 'Enter your full name here',
  'registration.form.name.required': 'Please enter your name',
  'registration.form.email.label': 'Email',
  'registration.form.email.placeholder': 'Enter your email here',
  'registration.form.email.required': 'Please enter your email',
  'registration.form.email.error': 'Please enter a valid email',
  'registration.form.phone.label': 'Phone Number',
  'registration.form.phone.placeholder': 'Enter your phone number here',
  'registration.form.phone.required': 'Please enter your phone number',
  'registration.form.phone.error': 'Please enter a valid phone number',
  'registration.form.gender.label': 'Gender',
  'registration.form.gender.male': 'Male',
  'registration.form.gender.female': 'Female',
  'registration.form.gender.required': 'Please select your gender',
  'registration.form.date-of-birth.label': 'Date of Birth',
  'registration.form.date-of-birth.placeholder': 'Enter your date of birth',
  'registration.form.date-of-birth.required': 'Please enter your date of birth',
  'registration.form.date-of-birth.error': 'Please enter a valid date of birth',
  'registration.form.parent.label': 'Parent/Guardian Name',
  'registration.form.parent.placeholder': 'Enter your parent/guardian name',
  'registration.form.parent.required': 'Please enter your parent/guardian name',
  'registration.form.parent.error': 'Please enter a valid parent/guardian name',
  'registration.form.parent-email.label': 'Parent/Guardian Email',
  'registration.form.parent-email.placeholder':
    'Enter your parent/guardian email',
  'registration.form.parent-email.required':
    'Please enter your parent/guardian email',
  'registration.form.parent-email.error':
    'Please enter a valid parent/guardian email',
  'registration.form.parent-phone.label': 'Parent/Guardian Phone',
  'registration.form.parent-phone.placeholder':
    'Enter your parent/guardian phone',
  'registration.form.parent-phone.required':
    'Please enter your parent/guardian phone',
  'registration.form.parent-phone.error':
    'Please enter a valid parent/guardian phone',
  'registration.form.meals.title': 'Meals',
  'registration.form.meals.disclaimer':
    'Please Note, we may not be able to accommodate all allergies/sensitivities, but will do our best to accommodate you',
  'registration.form.meals.label': 'Meals',
  'registration.form.meals.description':
    'Please select your meal preference. Meals are only available for attendees. Exhibitors must make their own arrangements.',
  'registration.form.meals.yes': 'Weekend Meals (5 Meals) ($60.00)',
  'registration.form.meals.no': 'No Meals',
  'registration.form.meals.required': 'Please select your meal preference',
  'registration.form.meals.error': 'Please select a meal preference',
  'registration.form.dietary-restrictions.label': 'Dietary Restrictions',
  'registration.form.dietary-restrictions.placeholder':
    'Enter any dietary restrictions here',
  'registration.form.dietary-restrictions.required':
    'Please enter your dietary restrictions',
  'registration.form.outreach.label': 'Outreach',
  'registration.form.outreach.description': `What's your preference in terms of which outreach project you'd like to take part in? Outreach will happen Sabbath, August 19th after lunch. Transportation will be provided. Please note, picking one over another doesn't guarantee that you will be able to join in that specific outreach project, but there is a very large chance you will be able to. Please keep in mind that projects like these are very fluid and are subject to change.`,
  'registration.form.outreach.laws-of-health': '8 Laws of Health Fair',
  'registration.form.outreach.homeless-carepacks':
    'Summer Care Packs for the Homeless',
  'registration.form.outreach.back-to-school': 'Back to School Shoes Giveaway',
  'registration.form.outreach.not-sure': `I'm not sure`,
  'registration.form.outreach.required':
    'Please select an outreach preference',
  'registration.form.how-did-you-hear.label': 'How did you hear about us?',
  'registration.form.how-did-you-hear.placeholder':
    'Enter how you heard about us here',
  'registration.form.how-did-you-hear.required':
    'Please tell us how you heard about us',
  'registration.form.why-are-you-attending.label': 'Why are you attending?',
  'registration.form.why-are-you-attending.placeholder':
    'Enter why you are attending here',
  'registration.form.why-are-you-attending.required':
    'Please tell us why you are attending',
  'registration.form.what-are-you-excited-about.label': `What are you most excited for this conference?`,
  'registration.form.what-are-you-excited-about.placeholder': `Enter what you're excited about here`,
  'registration.form.what-are-you-excited-about.required': `Please tell us what you are excited about`,
  'registration.form.first-time-attending.label': 'First Time Attending?',
  'registration.form.first-time-attending.yes': 'Yes',
  'registration.form.first-time-attending.no': 'No',
  'registration.form.first-time-attending.required':
    'Please select if this is your first time attending',
  'registration.form.first-time-attending.error':
    'Please select if this is your first time attending',
  'registration.form.church.label': 'Do you attend a church? If so, which one?',
  'registration.form.church.placeholder': 'Enter your church here',
  'registration.form.church.required': 'Please enter your church',
  'registration.form.merch.label': 'Merchandise',
  'registration.form.merch.t-shirt': 'T-Shirt',
  'registration.form.merch.hoodie': 'Hoodie',
  'registration.form.merch.shirt': 'Long Sleeve Shirt',
  'registration.form.merch.none': `Merch isn't for me`,
  'registration.form.merch.required': 'Please select a merchandise option',
  'registration.form.other.label': 'Other',
  'registration.form.other.placeholder': 'Enter any other notes here',
  'registration.form.other.required': 'Please enter any other notes',
  'registration.form.tos.label': 'Terms of Service',
  'registration.form.tos.required': 'Please accept the terms of service',
  'registration.form.tos.error': 'Please accept the terms of service',
  'registration.form.tos.agree': 'I agree to the terms of service',
  'registration.form.volunteer.required':
    'Please select a valid volunteer option',
  'registration.form.song-leader.label': 'Song Service Leader',
  'registration.form.musician.label': 'Song Service Musician',
  'registration.form.instrument.label': 'Instrument',
  'registration.form.instrument.placeholder': 'Enter your instrument here',
  'registration.form.instrument.required': 'Please enter your instrument',
  'registration.form.special-music.label': 'Special Music',
  'registration.form.hospitality.label': 'Hospitality',
  'registration.form.hospitality.description': 'Food prep, etc!',
  'registration.form.registration-station.label': 'Registration Station',
  'registration.form.usher.label': 'Usher',
  'registration.form.usher.description': 'Parking, tents, and meals',
  'registration.form.outreach-leader.label': 'Outreach Leader',
  'registration.form.small-group-leader.label': 'Small Group Leader',
  'registration.form.seminar-room-host.label': 'Seminar Room Host',
  'registration.form.camera-operator.label': 'Camera Operator',
  'registration.form.photographer.label': 'Photographer',
  'registration.form.roaming-mic.label': 'Roaming Mic',
  'registration.form.company.label': 'Company',
  'registration.form.company.placeholder': 'Enter your company here',
  'registration.form.company.required': 'Please enter your company',
  'registration.form.synopsis.label': 'Synopsis',
  'registration.form.synopsis.placeholder': 'Enter your synopsis here',
  'registration.form.synopsis.required': 'Please enter your synopsis',
  'registration.form.website.label': 'Website',
  'registration.form.website.placeholder': 'Enter your website here',
  'registration.form.website.required': 'Please enter your website',

  'registration.form.submit': 'Submit',
} as const;

export type TranslationKey = keyof typeof en;

const fr: Record<TranslationKey, string> = {
  'main.reserve': 'En savoir plus',
  'main.read_bible': 'Lire en contexte',

  'main.time_left': 'Rendez-vous dans {{days}} jours',

  'main.meet_the_team': 'Rencontrez l’équipe',
  'main.newsletter.name.label': 'Nom complet',
  'main.newsletter.name.placeholder': 'Nom complet',
  'main.newsletter.email.placeholder': 'Courriel',
  'main.newsletter.email.label': 'Courriel',
  'main.newsletter.email.error': 'Veuillez entrer une adresse courriel valide.',
  'main.newsletter.name.required': 'Veuillez entrer votre nom.',
  'main.newsletter.submit': "S'inscrire",
  'main.newsletter.error':
    "Une erreur s'est produite lors de votre inscription. Veuillez réessayer plus tard.",
  'main.newsletter.success.title': 'Vous avez été inscrit avec succès!',
  'main.newsletter.success.description': 'Merci pour votre inscription!',

  'nav.home': 'Conférence {{year}}',
  'nav.about': 'À propos de nous',
  'nav.team': 'Rencontrez l’équipe',
  'nav.contact': 'Entrez en contact',
  'nav.give': 'Faites un don',
  'nav.volunteer': 'Devenez volontaire',
  'nav.faq': 'FAQ',
  'footer.copy': `© ${new Date().getFullYear()} GYC Canada. Tous droits réservés.`,
  'footer.affiliation': 'Un ministère affilié à {{gyc}}.',
  'footer.links': 'Liens rapides',
  'contact.form.name': 'Quel est votre nom?',
  'contact.form.name.placeholder': 'Entrez votre nom complet ici',
  'contact.form.name.required': 'Veuillez entrer votre nom',
  'contact.form.name.error': 'Veuillez entrer votre nom',
  'contact.form.contact-method': 'Méthode de contact préférée: ',
  'contact.form.contact-method.email': 'Courriel',
  'contact.form.contact-method.phone': 'Téléphone',
  'contact.form.contact-method.both': 'Courriel et téléphone',
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
  'contact.form.success.title': 'Merci de nous avoir contacté!',
  'contact.form.success.description':
    'Votre message a été envoyé avec succès! Nous en prendrons connaissance et vous répondrons dès que possible.',
  'give.directions': 'Voici comment vous pouvez donner :',
  'give.continue': 'Continuer',
  // Team page chrome (title / movement / image.alt / logo.alt / subtitle / board)
  // migrated to the CMS `TeamPage`; `team.position.*` + `nav.team` stay (see EN).
  'team.position.president': 'Président',
  'team.position.vice-president': 'Vice-président général',
  'team.position.vp-logistics': 'Vice-président de la logistique',
  'team.position.vp-communications': 'Vice-président des communications',
  'team.position.vp-networking': 'Vice-président du réseautage',
  'team.position.vp-missions': 'Vice-président des missions',
  'team.position.secretary': 'Secrétaire exécutif',
  'team.position.treasurer': 'Trésorier',
  'volunteer.form.name.label': 'Quel est votre nom?',
  'volunteer.form.name.placeholder': 'Entrez votre nom complet ici',
  'volunteer.form.name.required': 'Veuillez entrer votre nom',
  'volunteer.form.method.label': 'Préférez-vous le téléphone ou le courriel?',
  'volunteer.form.method.email': 'Courriel',
  'volunteer.form.method.phone': 'Téléphone',
  'volunteer.form.method.both': 'Courriel et téléphone',
  'volunteer.form.method.required':
    'Veuillez sélectionner une méthode de contact',
  'volunteer.form.email.label': 'Quelle est votre adresse courriel?',
  'volunteer.form.email.placeholder': 'example@mail.com',
  'volunteer.form.email.required': 'Veuillez entrer votre adresse courriel',
  'volunteer.form.email.error': 'Veuillez entrer une adresse courriel valide',
  'volunteer.form.phone.label': 'Quel est votre numéro de téléphone?',
  'volunteer.form.phone.placeholder': '123-456-7890',
  'volunteer.form.phone.required': 'Veuillez entrer votre numéro de téléphone',
  'volunteer.form.age.label': 'Quel est votre âge?',
  'volunteer.form.age.placeholder': 'Entrez votre âge ici',
  'volunteer.form.age.required': 'Veuillez entrer votre âge',
  'volunteer.form.location.label': 'Où êtes-vous situé?',
  'volunteer.form.location.placeholder': 'Entrez votre emplacement ici',
  'volunteer.form.location.required': 'Veuillez entrer votre emplacement',
  'volunteer.form.background.label':
    "S'il-vous-plait, dites-nous en davantage sur vous et votre parcours?",
  'volunteer.form.background.placeholder': 'Entrez votre parcours ici',
  'volunteer.form.background.required': 'Veuillez entrer votre parcours',
  'volunteer.form.why.label':
    "Qu'est-ce qui vous motive à faire du bénévolat avec nous?",
  'volunteer.form.why.placeholder': 'Entrez votre raison ici',
  'volunteer.form.why.required': 'Veuillez entrer votre raison',
  'volunteer.form.submit': 'Soumettre',
  'volunteer.form.error':
    "Une erreur s'est produite lors de l'envoi de votre message. Veuillez réessayer plus tard.",
  'volunteer.form.success.description':
    'Votre message a été envoyé avec succès!',
  'volunteer.form.success.title': 'Merci pour votre intérêt!',

  'registration.schedule': 'Horaire',
  'registration.watch-promo': 'Regardez la promo',
  'registration.register': 'Inscrivez-vous',
  'registration.speakers.title': 'Conférenciers',
  'registration.seminars.title': 'Séminaires',
  'registration.faq.title': 'Des questions?',
  'registration.faq.subtitle':
    "Des informations plus détaillées sur la conférence ne seront pas disponibles avant l'ouverture des inscriptions. Vous pouvez également nous contacter si vous avez besoin de nous joindre, ou consulter notre FAQ pour des réponses rapides.",
  'registration.faq.contact': 'Entrer en contact',
  'registration.faq.view': 'Voir FAQ',
  'registration.register.title': 'Inscrivez-vous!',
  'registration.register.subtitle':
    'Rendez-vous le 21 août à l’église adventiste de Rutland à Kelowna, en Colombie-Britannique. Inscrivez-vous avant le 22 juin pour bénéficier des tarifs de lancement.',
  'registration.register.button': "S'inscrire",
  'registration.hotels.description': `Il y a plusieurs hôtels à Kelowna, en Colombie-Britannique, ce qui peut rendre difficile de trouver les bons. Nous avons répertorié les hôtels les plus proches du lieu ci-dessous. Veuillez noter que vous pourriez économiser des sommes considérables en partageant des chambres avec des amis, en utilisant Airbnb ou en utilisant notre {{facebook}}`,
  'registration.hotels.description.facebook':
    'Groupe Facebook Rides & Roommates',

  'registration.form.title': 'Inscrivez-vous à GYC Canada {{year}}',
  'registration.form.error':
    "Une erreur s'est produite lors de l'envoi de votre inscription. Veuillez réessayer plus tard.",
  'registration.form.success.title': 'Merci de votre inscription!',
  'registration.form.success.description':
    'Votre inscription a bien été reçue. Nous vous contacterons bientôt avec plus de détails.',
  'registration.form.attendee': 'Participant',
  'registration.form.exhibitor': 'Exposant',
  'registration.form.type.required':
    'Veuillez indiquer si vous vous inscrivez comme participant ou exposant',
  'registration.form.name.label': 'Nom complet',
  'registration.form.name.placeholder': 'Entrez votre nom complet ici',
  'registration.form.name.required': 'Veuillez entrer votre nom',
  'registration.form.email.label': 'Courriel',
  'registration.form.email.placeholder': 'Entrez votre courriel ici',
  'registration.form.email.required': 'Veuillez entrer votre courriel',
  'registration.form.email.error':
    'Veuillez entrer une adresse courriel valide',
  'registration.form.phone.label': 'Numéro de téléphone',
  'registration.form.phone.placeholder': 'Entrez votre numéro de téléphone ici',
  'registration.form.phone.required':
    'Veuillez entrer votre numéro de téléphone',
  'registration.form.phone.error':
    'Veuillez entrer un numéro de téléphone valide',
  'registration.form.gender.label': 'Sexe',
  'registration.form.gender.male': 'Homme',
  'registration.form.gender.female': 'Femme',
  'registration.form.gender.required': 'Veuillez sélectionner votre sexe',
  'registration.form.date-of-birth.label': 'Date de naissance',
  'registration.form.date-of-birth.placeholder':
    'Entrez votre date de naissance',
  'registration.form.date-of-birth.required':
    'Veuillez entrer votre date de naissance',
  'registration.form.date-of-birth.error':
    'Veuillez entrer une date de naissance valide',
  'registration.form.parent.label': 'Nom du parent/tuteur',
  'registration.form.parent.placeholder':
    'Entrez le nom de votre parent/tuteur',
  'registration.form.parent.required':
    'Veuillez entrer le nom de votre parent/tuteur',
  'registration.form.parent.error':
    'Veuillez entrer un nom de parent/tuteur valide',
  'registration.form.parent-email.label': 'Courriel du parent/tuteur',
  'registration.form.parent-email.placeholder':
    'Entrez le courriel de votre parent/tuteur',
  'registration.form.parent-email.required':
    'Veuillez entrer le courriel de votre parent/tuteur',
  'registration.form.parent-email.error':
    'Veuillez entrer un courriel de parent/tuteur valide',
  'registration.form.parent-phone.label': 'Téléphone du parent/tuteur',
  'registration.form.parent-phone.placeholder':
    'Entrez le téléphone de votre parent/tuteur',
  'registration.form.parent-phone.required':
    'Veuillez entrer le téléphone de votre parent/tuteur',
  'registration.form.parent-phone.error':
    'Veuillez entrer un téléphone de parent/tuteur valide',
  'registration.form.meals.title': 'Repas',
  'registration.form.meals.disclaimer':
    'Veuillez noter que nous ne pourrons pas accommoder toutes les allergies/sensibilités, mais ferons de notre mieux pour vous accommoder',
  'registration.form.meals.label': 'Repas',
  'registration.form.meals.description':
    'Veuillez sélectionner votre préférence de repas. Les repas ne sont disponibles que pour les participants. Les exposants doivent faire leurs propres arrangements.',
  'registration.form.meals.yes': 'Repas du week-end (5 repas) (60,00 $)',
  'registration.form.meals.no': 'Pas de repas',
  'registration.form.meals.required':
    'Veuillez sélectionner votre préférence de repas',
  'registration.form.meals.error':
    'Veuillez sélectionner une préférence de repas',
  'registration.form.dietary-restrictions.label': 'Restrictions alimentaires',
  'registration.form.dietary-restrictions.placeholder':
    'Entrez toutes les restrictions alimentaires ici',
  'registration.form.dietary-restrictions.required':
    'Veuillez entrer vos restrictions alimentaires',
  'registration.form.outreach.label': 'Rayonnement',
  'registration.form.outreach.description': `Quelle est votre préférence en termes de projet de rayonnement auquel vous aimeriez participer? Le rayonnement aura lieu le sabbat 19 août après le déjeuner. Le transport sera fourni. Veuillez noter que choisir un projet plutôt qu’un autre ne garantit pas que vous pourrez participer à ce projet de rayonnement spécifique, mais il y a une très grande chance que vous puissiez le faire. Veuillez garder à l’esprit que des projets comme ceux-ci sont très fluides et peuvent changer.`,
  'registration.form.outreach.laws-of-health': 'Salon des 8 lois de la santé',
  'registration.form.outreach.homeless-carepacks':
    'Paquets de soins d’été pour les sans-abri',
  'registration.form.outreach.back-to-school':
    'Distribution de chaussures pour la rentrée scolaire',
  'registration.form.outreach.not-sure': `Je ne suis pas sûr`,
  'registration.form.outreach.required':
    'Veuillez sélectionner une préférence de rayonnement',
  'registration.form.how-did-you-hear.label':
    'Comment avez-vous entendu parler de nous?',
  'registration.form.how-did-you-hear.placeholder':
    'Entrez comment vous avez entendu parler de nous ici',
  'registration.form.how-did-you-hear.required':
    'Veuillez nous indiquer comment vous avez entendu parler de nous',
  'registration.form.why-are-you-attending.label': 'Pourquoi assistez-vous?',
  'registration.form.why-are-you-attending.placeholder':
    'Entrez pourquoi vous assistez ici',
  'registration.form.why-are-you-attending.required':
    'Veuillez nous indiquer pourquoi vous assistez',
  'registration.form.what-are-you-excited-about.label': `Qu’est-ce qui vous excite le plus pour cette conférence?`,
  'registration.form.what-are-you-excited-about.placeholder': `Entrez ce qui vous excite ici`,
  'registration.form.what-are-you-excited-about.required': `Veuillez nous indiquer ce qui vous excite`,
  'registration.form.first-time-attending.label':
    'Première fois que vous assistez?',
  'registration.form.first-time-attending.yes': 'Oui',
  'registration.form.first-time-attending.no': 'Non',
  'registration.form.first-time-attending.required':
    'Veuillez sélectionner si c’est votre première fois que vous assistez',
  'registration.form.first-time-attending.error':
    'Veuillez sélectionner si c’est votre première fois que vous assistez',
  'registration.form.church.label':
    'Fréquentez-vous une église? Si oui, laquelle?',
  'registration.form.church.placeholder': 'Entrez votre église ici',
  'registration.form.church.required': 'Veuillez entrer votre église',
  'registration.form.merch.label': 'Marchandise',
  'registration.form.merch.t-shirt': 'T-Shirt',
  'registration.form.merch.hoodie': 'Chandail à capuchon',
  'registration.form.merch.shirt': 'Chandail à manches longues',
  'registration.form.merch.none': `La marchandise n’est pas pour moi`,
  'registration.form.merch.required':
    'Veuillez sélectionner une option de marchandise',
  'registration.form.other.label': 'Autre',
  'registration.form.other.placeholder': 'Entrez toutes autres notes ici',
  'registration.form.other.required': 'Veuillez entrer toutes autres notes',
  'registration.form.tos.label': 'Conditions d’utilisation',
  'registration.form.tos.required':
    'Veuillez accepter les conditions d’utilisation',
  'registration.form.tos.error':
    'Veuillez accepter les conditions d’utilisation',
  'registration.form.tos.agree': 'J’accepte les conditions d’utilisation',
  'registration.form.volunteer.required':
    'Veuillez sélectionner une option de bénévolat valide',
  'registration.form.song-leader.label': 'Chef du service de chant',
  'registration.form.musician.label': 'Musicien du service de chant',
  'registration.form.instrument.label': 'Instrument',
  'registration.form.instrument.placeholder': 'Entrez votre instrument ici',
  'registration.form.instrument.required': 'Veuillez entrer votre instrument',
  'registration.form.special-music.label': 'Musique spéciale',
  'registration.form.hospitality.label': 'Hospitalité',
  'registration.form.hospitality.description': 'Préparation des repas, etc!',
  'registration.form.registration-station.label': 'Station d’inscription',
  'registration.form.usher.label': 'Usher',
  'registration.form.usher.description': 'Stationnement, tentes et repas',
  'registration.form.outreach-leader.label': 'Chef du rayonnement',
  'registration.form.small-group-leader.label': 'Chef de petit groupe',
  'registration.form.seminar-room-host.label':
    'Animateur de salle de séminaire',
  'registration.form.camera-operator.label': 'Opérateur de caméra',
  'registration.form.photographer.label': 'Photographe',
  'registration.form.roaming-mic.label': 'Microphone ambulant',
  'registration.form.company.label': 'Entreprise',
  'registration.form.company.placeholder': 'Entrez votre entreprise ici',
  'registration.form.company.required': 'Veuillez entrer votre entreprise',
  'registration.form.synopsis.label': 'Synopsis',
  'registration.form.synopsis.placeholder': 'Entrez votre synopsis ici',
  'registration.form.synopsis.required': 'Veuillez entrer votre synopsis',
  'registration.form.website.label': 'Site Web',
  'registration.form.website.placeholder': 'Entrez votre site Web ici',
  'registration.form.website.required': 'Veuillez entrer votre site Web',
  'registration.form.submit': 'Soumettre',
};

export const root = {
  en,
  fr,
} as const satisfies Record<Locale, Record<TranslationKey, string>>;
