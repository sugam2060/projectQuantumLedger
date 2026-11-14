// Mock implementation of bcryptjs
const bcrypt = {
  compare: jest.fn().mockImplementation((data, encrypted) => {
    // In tests, we'll assume the password is correct
    return Promise.resolve(true);
  }),
  hash: jest.fn().mockImplementation((data, saltOrRounds) => {
    return Promise.resolve('$2a$10$hashedPassword');
  }),
};

export = bcrypt;


//node -e "require('bcryptjs').hash('YOUR_PASSWORD', 10).then(console.log)"