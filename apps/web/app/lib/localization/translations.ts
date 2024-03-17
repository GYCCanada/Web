import { Locale } from './localization';

const en = {
  'nav.home': 'GYC Canada',
  'nav.about': 'Our Story',
  'nav.team': 'Meet the Team',
  'nav.contact': 'Get in Touch',
  'nav.give': 'Give to the Mission',
  'nav.volunteer': 'Join the Movement',
  'footer.copy': `© ${new Date().getFullYear()} GYC Canada. All rights reserved.`,
  'footer.affiliation': 'A {{gyc}} affiliate ministry.',
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
} as const;

export type TranslationKey = keyof typeof en;

const fr = {
  'nav.home': 'GYC Canada',
  'nav.about': 'Notre histoire',
  'nav.team': 'Rencontrez l’équipe',
  'nav.contact': 'Entrer en contact',
  'nav.give': 'Donnez à la mission',
  'nav.volunteer': 'Rejoignez le mouvement',
  'footer.copy': `© ${new Date().getFullYear()} GYC Canada. Tous droits réservés.`,
  'footer.affiliation': 'Un ministère affilié à {{gyc}}.',
  'contact.title': 'Faites partie du {{movement}}',
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
} as const satisfies Record<TranslationKey, string>;

export const root = {
  en,
  fr,
} as const satisfies Record<Locale, Record<TranslationKey, string>>;
