'use strict';
const yeoman = require('yeoman-generator');
const chalk = require('chalk');
const yosay = require('yosay');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const q = require('q');
const ejs = require('ejs');
const uuid = require('node-uuid');
const URL = require('url');

module.exports = yeoman.Base.extend({

  constructor: function () {
    // Calling the super constructor is important so our generator is correctly set up
    yeoman.Base.apply(this, arguments);

    this.log(yosay('Welcome to ' + chalk.blue('VULCAIN') + ' generator'));

    this.answers = {};
  },

  loadTeams: function () {
    return this.loadVulcainData('/api/team.names');
  },

  loadTemplates: function () {
    return this.loadVulcainData('/api/template.all?kind=CodeGeneration');
  },

  loadServices: function () {
    return this.loadVulcainData(`/api/service.all?team=${this.answers.vulcain.team}&withDiscoveryAddress=true`);
  },
  loadVulcainData: function (path) {
    return new Promise((resolve, reject) => {
      if (!this.answers.vulcain) {
        reject('invalid vulcain config');
        return;
      }

      if (!path) {
        resolve();
        return;
      }

      var r = http.request({
        host: this.answers.vulcain.host,
        port: this.answers.vulcain.port,
        path: path,
        protocol: 'http:',
        method: 'GET',
        headers: {
          'Authorization': `ApiKey ${this.answers.vulcain.token}`
        }
      },
        res => {
          //console.log('STATUS: ' + res.statusCode);
          if (res.statusCode !== 200) {
            reject(`Error on ${path} : status: ${res.statusCode} ${res.body}`);
          }
          let data = '';
          res.on('data', (chunk) => data += chunk);

          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            }
            catch (err) {
              reject(err);
            }

          });
        });
      r.end();
    });
  },

  prompting: {
    selectVulcainProfile: function () {
      // this.log('Vulcain Profile');

      var done = this.async();

      var homeDir = path.join(os.homedir(), '.vulcain');
      var filePath = path.join(homeDir, 'configs.json');

      if (!fs.existsSync(filePath)) {
        throw 'Vulcain is installed or not configured';
      }

      var vulcainConfig = JSON.parse(fs.readFileSync(filePath).toString());
      var choices = [];
      var selectedIndex = 0;
      var currIndex = 0;

      for (var p in vulcainConfig.data) {
        choices.push({ name: p, checked: p === vulcainConfig.defaultProfile });
        if (p === vulcainConfig.defaultProfile) {
          selectedIndex = currIndex;
        }
        currIndex++;
      }

      if (choices.length === 1) { // Only one profile
        let profile = vulcainConfig.defaultProfile;
        let uri = URL.parse(vulcainConfig.data[profile].server);
        this.answers.vulcain = {
          profile: profile,
          host: uri.hostname,
          port: uri.port || 80,
          token: vulcainConfig.data[profile].token,
          team: vulcainConfig.data[profile].team
        };
        done();
        return;
      }

      var prompts = [{
        name: 'vulcainProfile', type: 'list', message: 'Select a Vulcain profile', choices: choices, default: selectedIndex
      }];

      this.prompt(prompts).then(answers => {
        let uri = URL.parse(vulcainConfig.data[answers.vulcainProfile].server);

        this.answers.vulcain = {
          profile: answers.vulcainProfile,
          host: uri.hostname,
          port: uri.port || 80,
          token: vulcainConfig.data[answers.vulcainProfile].token,
          team: vulcainConfig.data[answers.vulcainProfile].team
        };
        done();
      });
    },
    selectTeam: function () {
      //this.log('Vulcain domain selector');

      var done = this.async();

      this.loadTeams().then(data => {
        this.teams = data.value;

        if (this.teams.length === 1) {
          this.answers.vulcain.team = this.teams[0];
            done();
          return;
        }

        var choices = [];
        var selectedIndex = 0;
        var currIndex = 0;

        //console.log("team=" + this.answers.vulcain.team);
        for (let team of this.teams) {
          choices.push({ name: team, checked: team === this.answers.vulcain.team });
          if (team === this.answers.vulcain.team) {
            selectedIndex = currIndex;
          }
          currIndex++;
        }

        var prompts = [
          { name: 'vulcainTeam', type: 'list', message: 'Select target domain ', choices: choices, default: selectedIndex }
        ];

        this.prompt(prompts).then(answers => {
          this.answers.vulcain.team = answers.vulcainTeam;
          done();
        });
      });
    },

    selectTemplate: function () {
      // this.log('Vulcain template selector');

      var done = this.async();

      this.loadTemplates().then(data => {
        this.teamplates = data.value;

        var prompts = [
          { name: 'serviceTemplate', type: 'list', message: 'Select a template', choices: data.value.map(t => { return { name: t.name, value: t }; }) }
        ];

        this.prompt(prompts).then(answers => {
          //this.log(JSON.stringify(answers, null, 2));

          this.answers.template = answers.serviceTemplate;

          //instanciate context to get remaining questions
          var ctxCode = this.answers.template.data.contextCode;
          if (!fs.existsSync(this.templatePath())) {
            fs.mkdir(this.templatePath());
          }
          var tempFilePath = this.templatePath(`${uuid.v4()}.js`);
          fs.writeFileSync(tempFilePath, ctxCode);

          var Context = require(`${tempFilePath}`);
          //remove temp file
          fs.unlink(tempFilePath);

          this.answers.template.executingContext = new Context.Context();

          var contextPromptsBuilder = this.answers.template.executingContext.prompts().map(p => {
            return new Promise((resolve, reject) => {
              switch (p.lookup) {
                case 'service.all':
                  p.choices = [];
                  this.loadServices().then(
                    svcs => {
                      if (svcs.error) {
                        reject(svcs.error);
                      } else {
                        svcs.value.forEach(svc => {
                          svc.versions.forEach(v => {
                            p.choices.push({
                              name: `${svc.name}@${v.version}`,
                              checked: false,
                              value: v.discoveryAddress
                            });
                          });
                        });
                      }
                    },
                    err => reject(err)
                  ).then(() => resolve(p));
                  break;
                default:
                  resolve(p);
              }
            });
          });

          q.all(contextPromptsBuilder).then(prompts => {
            this.prompt(prompts).then(ctxAnswers => {
              this.answers.template.initializationData = ctxAnswers;
              done();
            });
          });

        });
      });
    }

  },

  writing: function () {
    var self = this;
    var done = this.async();
    this.log('Writing');

    var context = this.answers.template.executingContext;
    context.init.call(context, this.answers.template.initializationData).then((outFilePath) => {
      if (this.answers.template.initializationData) {
        for (var p in this.answers.template.initializationData) {
          context[p] = this.answers.template.initializationData[p];
        }
      }
      var out = ejs.render(
        self.answers.template.data.templateCode,
        context
      );

      self.fs.write(
        self.destinationPath(outFilePath),
        out
      );

      done();
    });
  },

  install: function () {
    // this.installDependencies();
  }
});
