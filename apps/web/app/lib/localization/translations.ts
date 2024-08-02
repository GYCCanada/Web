import { serverOnly$ } from 'vite-env-only/macros';

import { Locale } from './localization';

const en = {
  'main.reserve': 'Learn More',
  'main.read_bible': 'Read in Context',
  'main.time_left': 'See you in {{days}} days',
  'main.gyc_tagline':
    'GYC Canada is a {{movement}} founded by young people {{for}} young people.',
  'main.gyc_tagline.movement': 'movement',
  'main.gyc_tagline.for': 'for',
  'main.read_our_story': 'Read our story',
  'main.meet_the_team': 'Meet the team',
  'main.newsletter.title': 'Stay in the loop',
  'main.newsletter.subtitle':
    'We’ll send our monthly newsletter straight to your inbox, giving you a chance for early-bird pricing the moment it launches, updates on all our latest projects, and more!',
  'main.newsletter.name.label': 'Full Name',
  'main.newsletter.name.placeholder': 'Full Name',
  'main.newsletter.email.label': 'Email',
  'main.newsletter.email.placeholder': 'Email',
  'main.newsletter.submit': 'Sign up',
  'main.newsletter.error':
    'An error occurred while signing you up. Please try again later.',
  'main.newsletter.success.description':
    'You have been signed up successfully!',
  'main.newsletter.success.title': 'Thank you for signing up!',
  'main.socials.title':
    'Don’t forget to follow us on social media to get to know our team and stay up-to-date!',
  'main.join.title': 'Join the Movement',
  'main.join.subtitle':
    'GYC Canada is a non-profit organization run by a handful of amazing volunteers.{{br}}That means we depend entirely on your attendance and your generous donations to keep the movement growing.',
  'main.donate.link': 'Consider donating',
  'main.join.link': 'Volunteer',

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
  'contact.title': 'Get in touch with us!',
  'contact.directions':'',
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
  'give.title': 'Support the {{movement}}.',
  'give.movement': 'movement',
  'give.reason':
  "Our call to mission, is to be the light of the world. Our Savior calls us to a worldwide mission of spreading the gospel of Christ's love in this world filled with darkness. This light should not be hidden in a corner, covered by the humdrum of life, but out in the open, where all can see and hear. GYC Canada wants to magnify that light, to bring it to all of Canada and the world.",
  'give.directions': "Here's how you can give:",
  'give.directions.1': "Enter the amount you'd like to give.",
  'give.directions.2': 'Choose your preferred payment method.',
  'give.directions.3':
    'If you want to give monthly, tap on "Make this a monthly donation".',
  'give.directions.4':
    'If there\'s a specific purpose for your gift, let us know in the "Add a note" section.',
  'give.continue': 'Continue',
  'team.title': 'The people behind the {{movement}}.',
  'team.title.movement': 'movement',
  'team.image.alt': 'A group of young people smiling and standing together.',
  'team.logo.alt': 'GYC Canada Logo',
  'team.subtitle':
    'We are GYC Canada, young people dedicated to spreading the Gospel and living the lives that God has planned for us. As ambassadors of Christ in this world, we are fulfilling His purpose for us and go boldly where our Savior leads.',
  'team.board': 'Board of Directors',
  'team.position.president': 'President',
  'team.position.vice-president': 'General Vice President',
  'team.position.vp-logistics': 'VP of Logistics',
  'team.position.vp-communications': 'VP of Communications',
  'team.position.vp-networking': 'VP of Networking',
  'team.position.vp-missions': 'VP of Missions',
  'team.position.secretary': 'Executive Secretary',
  'team.position.treasurer': 'Treasurer',
  'volunteer.title': 'Become a part of the {{movement}}.',
  'volunteer.title.movement': 'movement',
  'volunteer.subtitle':
    'Join a group of dedicated and passionate young people, professionals, and laypersons. As a youth-led organization, GYC is mobilizing to share Christ with all of Canada.',
  'volunteer.directions': 'Select the area you are interested in:',
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
  'volunteer.form.background.label': 'Please tell us more about yourself and your background.',
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
  'registration.hotels.description': "There are quite a few hotels in Kelowna, BC which can make it daunting to find the right one. We've listed the closest hotels to the Venue below. Please keep in mind that you may be able to save a considerable amount of money by getting a room with friends, using Airbnb or by using our {{facebook}}",
  'registration.hotels.description.facebook':
    'Facebook Rides & Roommates Group',
  'registration.form.title': 'Register for GYC Canada {{year}}',
  'registration.form.attendee': 'Attendee',
  'registration.form.exhibitor': 'Exhibitor',
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
  'registration.form.outreach.label': 'Outreach',
  'registration.form.outreach.description': `What's your preference in terms of which outreach project you'd like to take part in? Outreach will happen Sabbath, August 19th after lunch. Transportation will be provided. Please note, picking one over another doesn't guarantee that you will be able to join in that specific outreach project, but there is a very large chance you will be able to. Please keep in mind that projects like these are very fluid and are subject to change.`,
  'registration.form.outreach.laws-of-health': '8 Laws of Health Fair',
  'registration.form.outreach.homeless-carepacks':
    'Summer Care Packs for the Homeless',
  'registration.form.outreach.back-to-school': 'Back to School Shoes Giveaway',
  'registration.form.outreach.not-sure': `I'm not sure`,
  'registration.form.how-did-you-hear.label': 'How did you hear about us?',
  'registration.form.how-did-you-hear.placeholder':
    'Enter how you heard about us here',
  'registration.form.why-are-you-attending.label': 'Why are you attending?',
  'registration.form.why-are-you-attending.placeholder':
    'Enter why you are attending here',
  'registration.form.what-are-you-excited-about.label': `What are you most excited for this conference?`,
  'registration.form.what-are-you-excited-about.placeholder': `Enter what you're excited about here`,
  'registration.form.first-time-attending.label': 'First Time Attending?',
  'registration.form.first-time-attending.yes': 'Yes',
  'registration.form.first-time-attending.no': 'No',
  'registration.form.first-time-attending.required':
    'Please select if this is your first time attending',
  'registration.form.first-time-attending.error':
    'Please select if this is your first time attending',
  'registration.form.church.label': 'Do you attend a church? If so, which one?',
  'registration.form.church.placeholder': 'Enter your church here',
  'registration.form.merch.label': 'Merchandise',
  'registration.form.merch.t-shirt': 'T-Shirt',
  'registration.form.merch.hoodie': 'Hoodie',
  'registration.form.merch.shirt': 'Long Sleeve Shirt',
  'registration.form.merch.none': `Merch isn't for me`,
  'registration.form.other.label': 'Other',
  'registration.form.other.placeholder': 'Enter any other notes here',
  'registration.form.tos.label': 'Terms of Service',
  'registration.form.tos.required': 'Please accept the terms of service',
  'registration.form.tos.error': 'Please accept the terms of service',
  'registration.form.tos.agree': 'I agree to the terms of service',
  'registration.form.song-leader.label': 'Song Service Leader',
  'registration.form.musician.label': 'Song Service Musician',
  'registration.form.instrument.label': 'Instrument',
  'registration.form.instrument.placeholder': 'Enter your instrument here',
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

  'about.title': 'About Us',
  'about.1': `GYC Canada (Generation of Youth for Christ) is a youth-initiated and led
        movement of Seventh-day Adventists from various origins, united in a common
        commitment to serious Bible study, intense prayer, uncompromising
        lifestyle, and boldness in sharing Christ with others.`,
  'about.2': `GYC Canada seeks to uphold the distinctive message of the Seventh-day
        Adventist Church. We seek to equip and inspire young Adventists to be Christian
        ambassadors in their respective places of work and study and wherever they go.`,
  'about.3': `GYC Canada is the Canadian affiliate of the GYC movement initiated in 2002, 
        in the United States of America. We are Canadian Seventh-day Adventist young people 
        who seek to promote the spirit and ideals of GYC in Canada.`,
  'about.4': `GYC Canada is a recognized independent supporting ministry of the
        Seventh-day Adventist Church of Canada. GYC Canada encourages young Seventh-day Adventists across Canada
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

  'faq.title': 'Frequently Asked Questions',
  'faq.question.1.title': 'Exhibitor Booths',
  'faq.question.1.answer.1': `GYC Canada reserves the right to refuse any exhibitor that does not
          uphold the Spirit of GYC as documented in the 'About Us' section of our
          website. Email us with any questions at {{email}}.`,
  'faq.question.1.answer.2': `A single-table exhibitor booth can be reserved for the price of $100, and a
          two-table exhibitor booth for the price of $50. An exhibitor booth reservation does not include
          registration(s) for the person(s) running the booth to the conference. The Exhibit
          manager(s) must first register as attendees for the full conference.`,
  'faq.question.1.answer.3': `{{before}} registering, please email {{email}} to get approval for your booth. This can avoid issues with your booth,
          and can help avoid refund issues if we decide you are not a fit for our
          conference. `,
  'faq.question.1.answer.3.before': 'BEFORE',
  'faq.question.2.title': 'Cancellation and Refunds',
  'faq.question.2.answer.1': `Conference registration fees are strictly NON-refundable*. You may
          transfer your registration to another person as long as they qualify
          for the same type of registration. You must notify GYC Canada of this
          change by emailing us at {{email}}.`,
  'faq.question.2.answer.2': `* The ONLY exception to the above rule are government imposed restrictions that may
            inhibit in-person events`,
  'faq.question.3.title': 'Letter of Invitation',
  'faq.question.3.answer.1': `GYC Canada does not and will not provide you with a letter of
          invitation for any purpose. Everyone is welcome to attend our
          conference, but you as an attendee are fully responsible for ensuring
          you can attend and arranging your transport. We will have livestreams
          available for those who are not able to attend in person or would like
          to go back and review what was covered. Livestreams DO NOT cover
          Workshops or Breakouts, which are only available for those who attend
          in person. Livestreams will be available via our YouTube channel, Facebook page and
          Website ({{website}}). If
          you purchase a ticket and need an invitation, you are not viable for a
          refund.`,
  'faq.question.3.answer.1.website': 'gyccanada.org',
  'faq.question.3.answer.2': `All ticket sales are final.`,
} as const;

export type TranslationKey = keyof typeof en;

const fr: Record<TranslationKey, string> = {
  'main.reserve': 'En savoir plus',
  'main.read_bible': 'Lire en contexte',

  'main.time_left': 'Rendez-vous dans {{days}} jours',

  'main.gyc_tagline':
    'GYC Canada est un {{movement}} fondé par des jeunes {{for}} les jeunes.',
  'main.gyc_tagline.movement': 'mouvement',
  'main.gyc_tagline.for': 'pour',
  'main.read_our_story': 'Lisez notre histoire',
  'main.meet_the_team': 'Rencontrez l’équipe',
  'main.newsletter.title': 'Inscrivez-vous à notre bulletin d’information',
  'main.newsletter.subtitle':
    'Nous enverrons notre infolettre directement à votre boîte de réception, vous donnant la chance de profiter des tarifs de lancement, des nouvelles sur tous nos projets et bien plus!',
  'main.newsletter.name.label': 'Nom complet',
  'main.newsletter.name.placeholder': 'Nom complet',
  'main.newsletter.email.placeholder': 'Courriel',
  'main.newsletter.email.label': 'Courriel',
  'main.newsletter.submit': "S'inscrire",
  'main.newsletter.error':
    "Une erreur s'est produite lors de votre inscription. Veuillez réessayer plus tard.",
  'main.newsletter.success.title': 'Vous avez été inscrit avec succès!',
  'main.newsletter.success.description': 'Merci pour votre inscription!',

  'main.socials.title':
    'N’oubliez pas de nous suivre sur les réseaux sociaux pour mieux connaître notre équipe et rester à l’affût des nouveautés!',
  'main.join.title': 'Rejoignez le mouvement',
  'main.join.subtitle':
    'GYC Canada est une organisation à but non lucratif dirigée par une poignée de bénévoles incroyables.{{br}}Cela signifie que nous dépendons entièrement de votre présence et de vos généreux dons pour faire croître le mouvement.',
  'main.donate.link': 'Considérez un don',
  'main.join.link': 'Faire du bénévolat',
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
  'contact.title': 'Entrez en contact avec nous!',
  'contact.directions':'',
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
  'contact.form.success.description': 'Votre message a été envoyé avec succès! Nous en prendrons connaissance et vous répondrons dès que possible.',
  'give.title': 'Soutenez le {{movement}}.',
  'give.movement': 'mouvement',
  'give.reason':
    "Notre appel à la mission est d'être la lumière du monde. Notre Seigneur nous appelle à répandre la bonne nouvelle de l'amour de Christ dans un monde rempli de ténèbres. Cette lumière ne devrait pas être cachée ou couverte par la routine de la vie, mais bien en vue, afin que tout le monde puisse la voir et l'entendre. GYC Canada veut amplifier cette lumière, la faire briller partout au Canada et dans le monde.",
  'give.directions': 'Voici comment vous pouvez donner :',
  'give.directions.1': 'Entrez le montant que vous souhaitez donner.',
  'give.directions.2': 'Choisissez votre mode de paiement préféré.',
  'give.directions.3':
    'Si vous souhaitez donner mensuellement, cliquez sur "Faire un don mensuel".',
  'give.directions.4':
    'Si votre don a un but spécifique, veuillez nous en informer dans la section "Ajouter une note".',
  'give.continue': 'Continuer',
  'team.title': 'Les personnes derrière le {{movement}}.',
  'team.title.movement': 'mouvement',
  'team.image.alt': 'Un groupe de jeunes souriants et debout ensemble.',
  'team.logo.alt': 'Logo GYC Canada',
  'team.subtitle':
    "Nous sommes GYC Canada, des jeunes dédiés à faire connaître l'Évangile et à vivre les vies que Dieu a prévues pour nous. En tant qu'ambassadeurs de Christ dans ce monde, nous accomplissons Sa volonté pour nous et allons avec courage là où notre Seigneur nous conduit.",
  'team.board': 'Conseil d’administration',
  'team.position.president': 'Président',
  'team.position.vice-president': 'Vice-président général',
  'team.position.vp-logistics': 'Vice-président de la logistique',
  'team.position.vp-communications': 'Vice-président des communications',
  'team.position.vp-networking': 'Vice-président du réseautage',
  'team.position.vp-missions': 'Vice-président des missions',
  'team.position.secretary': 'Secrétaire exécutif',
  'team.position.treasurer': 'Trésorier',
  'volunteer.title': 'Faites partie du {{movement}}.',
  'volunteer.title.movement': 'mouvement',
  'volunteer.subtitle':
    'Rejoignez un groupe de jeunes adultes, de professionnels et de laïcs dédiés et passionnés. En tant qu’organisation dirigée par des jeunes, GYC se mobilise pour partager Christ avec tout le Canada.',
  'volunteer.directions': 'Sélectionnez le domaine qui vous intéresse :',
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
  'volunteer.form.background.label': "S'il-vous-plait, dites-nous en davantage sur vous et votre parcours?",
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
  'registration.form.attendee': 'Participant',
  'registration.form.exhibitor': 'Exposant',
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
  'registration.form.outreach.label': 'Rayonnement',
  'registration.form.outreach.description': `Quelle est votre préférence en termes de projet de rayonnement auquel vous aimeriez participer? Le rayonnement aura lieu le sabbat 19 août après le déjeuner. Le transport sera fourni. Veuillez noter que choisir un projet plutôt qu’un autre ne garantit pas que vous pourrez participer à ce projet de rayonnement spécifique, mais il y a une très grande chance que vous puissiez le faire. Veuillez garder à l’esprit que des projets comme ceux-ci sont très fluides et peuvent changer.`,
  'registration.form.outreach.laws-of-health': 'Salon des 8 lois de la santé',
  'registration.form.outreach.homeless-carepacks':
    'Paquets de soins d’été pour les sans-abri',
  'registration.form.outreach.back-to-school':
    'Distribution de chaussures pour la rentrée scolaire',
  'registration.form.outreach.not-sure': `Je ne suis pas sûr`,
  'registration.form.how-did-you-hear.label':
    'Comment avez-vous entendu parler de nous?',
  'registration.form.how-did-you-hear.placeholder':
    'Entrez comment vous avez entendu parler de nous ici',
  'registration.form.why-are-you-attending.label': 'Pourquoi assistez-vous?',
  'registration.form.why-are-you-attending.placeholder':
    'Entrez pourquoi vous assistez ici',
  'registration.form.what-are-you-excited-about.label': `Qu’est-ce qui vous excite le plus pour cette conférence?`,
  'registration.form.what-are-you-excited-about.placeholder': `Entrez ce qui vous excite ici`,
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
  'registration.form.merch.label': 'Marchandise',
  'registration.form.merch.t-shirt': 'T-Shirt',
  'registration.form.merch.hoodie': 'Chandail à capuchon',
  'registration.form.merch.shirt': 'Chandail à manches longues',
  'registration.form.merch.none': `La marchandise n’est pas pour moi`,
  'registration.form.other.label': 'Autre',
  'registration.form.other.placeholder': 'Entrez toutes autres notes ici',
  'registration.form.tos.label': 'Conditions d’utilisation',
  'registration.form.tos.required':
    'Veuillez accepter les conditions d’utilisation',
  'registration.form.tos.error':
    'Veuillez accepter les conditions d’utilisation',
  'registration.form.tos.agree': 'J’accepte les conditions d’utilisation',
  'registration.form.song-leader.label': 'Chef du service de chant',
  'registration.form.musician.label': 'Musicien du service de chant',
  'registration.form.instrument.label': 'Instrument',
  'registration.form.instrument.placeholder': 'Entrez votre instrument ici',
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

  'about.title': 'Notre histoire',
  'about.1': `GYC Canada (Generation of Youth for Christ) est un mouvement de jeunes
        adventistes du septième jour provenant de diverses origines, unis toutefois 
        par un engagement commun à un style de vie chrétien sans compromis:  
        une étude sérieuse de la Bible, une vie de prière active et le courage de 
        partager Christ avec les autres.`,
  'about.2': `GYC Canada soutient le message unique de l'Église
        adventiste du septième jour. Nous voulons équiper et inspirer les jeunes
        adventistes à être des ambassadeurs chrétiens dans leurs lieux respectifs de
        travail et d'études.`,
  'about.3': `GYC Canada est l'affilié canadien du mouvement GYC initié en 2002, 
        aux États-Unis d'Amérique. Nous sommes de jeunes canadiens, adventistes 
        du septième jour, qui cherchent à promouvoir l'esprit et les principes de GYC au Canada.`,
  'about.4': `GYC Canada est un ministère indépendant, soutenant
        l'Église adventiste du septième jour au Canada et reconnu par celle-ci. GYC Canada encourage 
        les jeunes adventistes du septième jour à être des membres actifs de leurs églises locales.`,
  'about.disclaimer': `Notice importante : GYC Canada n'accepte pas les dîmes.
        Nous encourageons les donateurs à donner leurs dîmes à leurs églises
        respectives.`,
  'about.quote.1': `“Que personne ne méprise ta jeunesse, mais sois un modèle pour les
          croyants en parole, en conduite, en amour, en foi et en pureté.” {{verse}}`,
  'about.quote.1.verse': '1 Timothée 4:12',
  'about.quote.2': `“Avec l'armée que formeraient nos jeunes, bien préparés, la bonne nouvelle de notre Sauveur crucifié, ressuscité, prêt à revenir, serait vite portée au monde entier.” {{source}}`,
  'about.quote.2.source': 'Éducation, p. 304.2',

  'faq.title': 'Foire aux questions',
  'faq.question.1.title': 'Stands d’exposants',
  'faq.question.1.answer.1': `GYC Canada se réserve le droit de refuser tout exposant qui ne
          respecte pas l’esprit de GYC tel que documenté dans la section 'À
          propos de nous' de notre site Web. Pour toute question envoyez-nous un message à l'adresse courriel {{email}}.`,

  'faq.question.1.answer.2': `Un stand d’exposant d’une table peut être acheté pour le prix de 100 $, et un
          stand d’exposant de deux tables pour le prix de 50 $. Un stand d’exposant n'inclut pas l’inscription à la conférence des personnes 
          qui présentent le stand. Le responsable du stand doit d'abord inscrire tous les présentateurs du stand en tant que participants à la conférence
          pour la durée totale de la conférence avant de réserver un stand d'exposant.`,

  'faq.question.1.answer.3': `Veuillez envoyer un courriel à {{email}}{{before}} de vous inscrire afin d'obtenir l’approbation pour votre stand. 
          Cela peut éviter des problèmes avec votre stand et de remboursement si jamais nous décidons que vous ne correspondez pas avec les critères pour participer à notre conférence.`,

  'faq.question.1.answer.3.before': 'AVANT',

  'faq.question.2.title': 'Annulation et remboursements',
  'faq.question.2.answer.1': `Les frais d’inscription à la conférence sont strictement NON-remboursables*. 
          Vous pouvez transférer votre inscription à une autre
          personne tant qu’elle est admissible pour le même type d’inscription.
          Vous devez informer GYC Canada de ce changement en nous envoyant un courriel à {{email}}.`,

  'faq.question.2.answer.2': `* La SEULE exception admissible à la règle mentionnée plus haut est le cas d'une restriction 
          imposée par le gouvernement qui pourrait empêcher la participation de quelqu'un à l'évènement.`,

  'faq.question.3.title': 'Lettre d’invitation',
  'faq.question.3.answer.1': `GYC Canada ne peut vous fournir une lettre
          d’invitation peu importe votre besoin. Tout le monde est le
          bienvenu à notre conférence, mais en tant que participant vous êtes
          entièrement responsable de vous assurer que vous pouvez y assister et êtes responsable
          d’organiser votre transport. Nous aurons des diffusions en direct
          disponibles pour ceux qui ne peuvent pas assister en personne ou
          aimeraient revenir sur ce qui a été présenté. Les diffusions en direct
          NE présenteront PAS les ateliers, car ceux-ci ne sont
          disponibles que pour ceux qui assistent en personne. Les diffusions en
          direct seront disponibles via notre canal YouTube, page Facebook et Site Web ({{website}}). Si vous achetez un billet et avez besoin d’une invitation, vous n’êtes pas admissible à un remboursement.`,
  'faq.question.3.answer.1.website': 'gyccanada.org',
  'faq.question.3.answer.2': `Toutes les ventes de billets sont finales.`,
};

export const root = serverOnly$({
  en,
  fr,
} as const satisfies Record<Locale, Record<TranslationKey, string>>)!;
