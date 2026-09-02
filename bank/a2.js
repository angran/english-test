/* ---------------- A2 · 基础（约 1000–2000 词汇量） ---------------- */
EXAM_BANK.bands.push({
  id: 'a2', cefr: 'A2', name: '基础', min: 0, max: 2000,
  rate: 0.82,
  vocabHint: '约 1000–2000 词',

  reading: [
    {
      title: 'A Rainy Monday',
      text: "Last Monday, Ben woke up late. His alarm clock did not ring because the battery was dead. He got dressed quickly, put some bread in his bag and ran to the bus stop. It was raining hard, and he forgot his umbrella at home.\n\nThe bus came ten minutes late. When Ben arrived at school, the first class had already started. His teacher, Mrs Clark, looked at him but said nothing. Ben sat down quietly and opened his book.\n\nAt lunch time, Ben told his friend Sara about his morning. Sara laughed and said, \"You should buy a new battery today.\" After school, they walked to the small shop near the park. Ben bought two batteries and an umbrella. The umbrella was blue, and it cost five pounds.\n\nThat evening, Ben put a new battery in his clock and put the umbrella next to the door. \"Tomorrow will be better,\" he thought.",
      questions: [
        { q: "Why did Ben's alarm clock not ring?", options: ['The battery was dead.', 'He forgot to set it.', 'His sister turned it off.', 'There was no electricity in the house.'], answer: 0 },
        { q: 'What did Ben leave at home?', options: ['His bag', 'His umbrella', 'His book', 'His money'], answer: 1 },
        { q: 'How did Ben travel to school?', options: ['On foot', 'By bike', 'By bus', 'By car'], answer: 2 },
        { q: 'What did Mrs Clark do when Ben came in late?', options: ['She sent him home.', 'She gave him extra homework.', 'She said nothing.', 'She phoned his mother.'], answer: 2 },
        { q: 'How much did the umbrella cost?', options: ['Two pounds', 'Five pounds', 'Ten pounds', 'Fifteen pounds'], answer: 1 }
      ]
    },
    {
      title: 'City Library — Information for New Members',
      text: "OPENING HOURS\nMonday to Friday: 9:00 a.m. - 7:00 p.m.\nSaturday: 10:00 a.m. - 5:00 p.m.\nThe library is closed on Sunday.\n\nHOW TO JOIN\nBring a photo ID and a letter that shows your address. Membership is free for people under 18. Adults pay 10 pounds a year.\n\nBORROWING\nYou can take up to six books for three weeks. You can keep a book for three more weeks if nobody else is waiting for it. Phone us or use our website to do this. If you bring a book back late, you pay 20p for each day.\n\nCOMPUTERS\nMembers can use the computers on the second floor for one hour a day. Please book a computer at the front desk first.\n\nFOOD AND DRINK\nWater is allowed. Please do not take food into the reading rooms.",
      questions: [
        { q: 'On which day is the library closed?', options: ['Saturday', 'Monday', 'Friday', 'Sunday'], answer: 3 },
        { q: 'How much does an adult pay for membership?', options: ['It is free.', '10 pounds a year', '20p a day', '6 pounds a year'], answer: 1 },
        { q: 'How many books can a member borrow at one time?', options: ['Three', 'Six', 'Ten', 'Eighteen'], answer: 1 },
        { q: 'What must you do before you use a computer?', options: ['Pay one pound', 'Book it at the front desk', 'Write your name on the door', 'Ask a librarian on the first floor'], answer: 1 },
        { q: 'What may you take into the reading rooms?', options: ['Water', 'Sandwiches', 'Hot coffee', 'Fruit'], answer: 0 }
      ]
    },
    {
      title: 'An Email from Tina',
      text: "Hi Lucy,\n\nThanks for your email. I am really happy that you can come to the coast with us on Saturday.\n\nWe plan to leave my house at eight o'clock in the morning, so please arrive at half past seven. My dad will drive, and there is space in the car for four people: my dad, my brother Sam, you and me.\n\nThe weather report says it will be sunny but windy, so bring a jacket. Do not bring lunch - we are going to eat in a small restaurant near the beach, and my dad says he will pay. You only need money for ice cream!\n\nIn the afternoon we want to walk up to the old castle. It takes about forty minutes and the path is not difficult, but please wear comfortable shoes.\n\nWe will be home by seven in the evening. Can you tell your mum?\n\nSee you on Saturday,\nTina",
      questions: [
        { q: "What time should Lucy arrive at Tina's house?", options: ['7:00', '7:30', '8:00', '8:30'], answer: 1 },
        { q: 'Who is going to drive the car?', options: ["Tina's mum", "Tina's dad", 'Sam', "Lucy's mum"], answer: 1 },
        { q: 'What does Tina tell Lucy NOT to bring?', options: ['A jacket', 'Money', 'Lunch', 'Comfortable shoes'], answer: 2 },
        { q: 'How long does the walk to the castle take?', options: ['About twenty minutes', 'About forty minutes', 'About one hour', 'About two hours'], answer: 1 },
        { q: 'Why will Lucy need a little money?', options: ['To pay for the restaurant', 'To buy a ticket for the castle', 'To buy ice cream', 'To pay for petrol'], answer: 2 }
      ]
    },
    {
      title: 'A Notice at Green Park Swimming Pool',
      text: "WELCOME TO GREEN PARK POOL\n\nTickets\nAdults: 4 pounds. Children under 12: 2 pounds. Children under 4 swim free, but an adult must stay in the water with them.\n\nTimes\nThe big pool is open every day from 7 a.m. to 9 p.m. From 7 a.m. to 9 a.m. the big pool is only for adults who want to swim fast. Families should use the small pool at this time.\n\nRules\nPlease take a shower before you enter the water. Do not run next to the pool. Do not bring glass bottles. Lockers cost 50p; you get your money back when you open the locker again.\n\nLessons\nSwimming lessons for children take place on Tuesday and Thursday afternoons. Ask for the form at the front desk. Lessons cost 30 pounds for eight weeks.",
      questions: [
        { q: 'How much does a ten-year-old child pay?', options: ['Nothing', '2 pounds', '4 pounds', '50p'], answer: 1 },
        { q: 'What can families do at 8 a.m.?', options: ['Swim in the big pool', 'Use the small pool', 'Wait outside until 9 a.m.', 'Swim free of charge'], answer: 1 },
        { q: 'What must people do before they get into the water?', options: ['Take a shower', 'Buy a locker key', 'Give their name to the staff', 'Put on a swimming hat'], answer: 0 },
        { q: 'What happens to the 50p for the locker?', options: ['You lose it.', 'You get it back later.', 'It pays for a towel.', 'It is only for adults.'], answer: 1 },
        { q: 'When are the lessons for children?', options: ['Every morning', 'Monday and Wednesday', 'Tuesday and Thursday afternoons', 'At the weekend'], answer: 2 }
      ]
    }
  ],

  listening: [
    {
      title: 'In a cafe',
      lines: [
        { s: 'W', t: 'Good morning. What can I get you?' },
        { s: 'M', t: 'A large coffee, please. And do you have any cheese sandwiches?' },
        { s: 'W', t: "I'm sorry, the cheese ones have finished. We have chicken or egg." },
        { s: 'M', t: "Then I'll take the egg one. How much is that?" },
        { s: 'W', t: "That's four pounds fifty. Would you like it to take away?" },
        { s: 'M', t: "No, thanks. I'll sit by the window." }
      ],
      questions: [
        { q: 'What sandwich does the man buy?', options: ['Cheese', 'Chicken', 'Egg', 'He buys no sandwich.'], answer: 2 },
        { q: 'How much does the man pay?', options: ['4 pounds 15', '4 pounds 50', '5 pounds 40', '5 pounds 50'], answer: 1 }
      ]
    },
    {
      title: 'At the station',
      lines: [
        { s: 'N', t: 'Attention please. The ten forty-five train to Manchester will now leave from platform six, not platform two. This train is running about fifteen minutes late. Passengers for Liverpool should change at Manchester. The next train to London leaves from platform one at ten fifty.' }
      ],
      questions: [
        { q: 'Which platform will the Manchester train leave from?', options: ['Platform one', 'Platform two', 'Platform six', 'Platform ten'], answer: 2 },
        { q: 'How late is the Manchester train?', options: ['About five minutes', 'About fifteen minutes', 'About forty-five minutes', 'About fifty minutes'], answer: 1 }
      ]
    },
    {
      title: 'A phone message',
      lines: [
        { s: 'W', t: "Hi Daniel, it's Emma from the office. I'm calling about tomorrow's meeting. We have to move it from nine o'clock to eleven, because Mr Baker's flight arrives late. We'll meet in the small room on the third floor, not the usual one. Please bring the sales report - you don't need to print it, just send it to my email tonight. Thanks. Bye." }
      ],
      questions: [
        { q: 'What time will the meeting start now?', options: ["Nine o'clock", "Ten o'clock", "Eleven o'clock", "Three o'clock"], answer: 2 },
        { q: 'What does Emma ask Daniel to do?', options: ['Print the sales report', 'Email the sales report to her', 'Meet Mr Baker at the airport', 'Book a bigger room'], answer: 1 }
      ]
    },
    {
      title: 'Weekend plans',
      lines: [
        { s: 'M', t: 'Are you free this weekend, Kate?' },
        { s: 'W', t: "On Saturday I'm working until four, but Sunday is free. Why?" },
        { s: 'M', t: "There's a new film at the cinema. We could go on Sunday afternoon." },
        { s: 'W', t: "I'd love to, but my sister is coming for lunch. How about the evening? The seven o'clock show?" },
        { s: 'M', t: "Perfect. I'll buy the tickets online tonight." }
      ],
      questions: [
        { q: 'When will they go to the cinema?', options: ['Saturday afternoon', 'Saturday evening', 'Sunday afternoon', 'Sunday evening'], answer: 3 },
        { q: "Why can't Kate go earlier on Sunday?", options: ['She is working.', 'Her sister is coming for lunch.', 'The tickets are sold out.', 'She does not like the film.'], answer: 1 }
      ]
    },
    {
      title: 'The weather this week',
      lines: [
        { s: 'N', t: 'And now the weather for the week. Monday will be cold and cloudy, with rain in the afternoon. On Tuesday the rain stops and we will see plenty of sun, but it stays windy near the coast. Wednesday brings warmer air from the south, around twenty-two degrees. Thursday and Friday will be dry, but temperatures fall again at night.' }
      ],
      questions: [
        { q: 'What will the weather be like on Tuesday?', options: ['Rainy all day', 'Sunny but windy', 'Cold and cloudy', 'Warm and foggy'], answer: 1 },
        { q: 'Which day will be the warmest?', options: ['Monday', 'Tuesday', 'Wednesday', 'Friday'], answer: 2 }
      ]
    },
    {
      title: 'Asking the way',
      lines: [
        { s: 'M', t: 'Excuse me, is there a post office near here?' },
        { s: 'W', t: 'Yes. Go straight down this road and turn left at the traffic lights.' },
        { s: 'M', t: 'Left at the lights. And then?' },
        { s: 'W', t: "It's about two hundred metres on your right, just after the bank. It's next to a small bookshop." },
        { s: 'M', t: 'Is it still open?' },
        { s: 'W', t: 'It closes at five thirty, and it is ten past five now, so you have twenty minutes. Better hurry!' }
      ],
      questions: [
        { q: 'Where is the post office?', options: ['Opposite the bank', 'Next to a bookshop', 'Inside the station', 'Behind the traffic lights'], answer: 1 },
        { q: 'What time is it now?', options: ['5:10', '5:30', '2:00', '6:00'], answer: 0 }
      ]
    }
  ],

  writing: [
    { type: 'short', minutes: 12, minWords: 60, maxWords: 90, prompt: 'Your friend has invited you to a birthday party next Saturday, but you cannot go.\n\nWrite an email to your friend. In your email:\n- thank your friend for the invitation;\n- explain why you cannot come;\n- suggest another day to meet.\n\nWrite 60-90 words.' },
    { type: 'essay', minutes: 20, minWords: 100, maxWords: 140, prompt: 'Some people like living in a big city; others prefer a small town.\n\nWhere do you prefer to live, and why? Give at least two reasons and one example from your own life.\n\nWrite 100-140 words.' },
    { type: 'short', minutes: 12, minWords: 60, maxWords: 90, prompt: 'You bought a jacket online last week, but the wrong size arrived.\n\nWrite a message to the shop. In your message:\n- say what you bought and when;\n- explain the problem;\n- say what you want the shop to do.\n\nWrite 60-90 words.' },
    { type: 'essay', minutes: 20, minWords: 100, maxWords: 140, prompt: 'Describe a person in your family who is important to you.\n\nSay who the person is, what he or she is like, and why this person matters to you.\n\nWrite 100-140 words.' }
  ],

  speaking: [
    { prepSec: 30, speakSec: 60, prompt: 'Introduce yourself.\n\nTalk about your name, where you live, your family, your job or studies, and what you do in your free time.\n\nPreparation: 30 seconds. Speak for about 1 minute.' },
    { prepSec: 45, speakSec: 90, prompt: 'Describe your typical day.\n\nSay what time you get up, what you do in the morning, the afternoon and the evening, and which part of the day you like best and why.\n\nPreparation: 45 seconds. Speak for about 1.5 minutes.' },
    { prepSec: 45, speakSec: 90, prompt: 'Talk about a place you like to visit.\n\nSay where it is, how you get there, what you do there, and why you like it.\n\nPreparation: 45 seconds. Speak for about 1.5 minutes.' },
    { prepSec: 30, speakSec: 60, prompt: 'Answer these three questions, one after the other:\n\n1. What food do you like most, and why?\n2. Do you prefer travelling by train or by car? Why?\n3. What would you like to do next weekend?\n\nPreparation: 30 seconds. Speak for about 1 minute in total.' }
  ]
});
